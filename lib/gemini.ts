import { z } from "zod";
import { coachingContext, parseCoachReply } from "./coach";
import { AppError } from "./errors";
import { geminiApiKey } from "./gemini-config";
import { emptyIdea, ideaFieldsSchema } from "./model";

export const chatMessageSchema = z.object({
  role: z.enum(["user", "model"]),
  text: z.string().trim().min(1).max(6000),
}).strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;

export const chatInputSchema = z.object({
  language: z.enum(["en", "de"]),
  fields: ideaFieldsSchema.pick({ title: true, problem: true }).strict(),
  messages: z.array(chatMessageSchema).min(1).max(11)
    .refine((messages) => messages.length % 2 === 1 &&
      messages.every((message, index) => message.role === (index % 2 === 0 ? "user" : "model")),
    "Expected alternating turns ending with a user message")
    .refine((messages) => messages.reduce((length, message) => length + message.text.length, 0) <= 10_000)
    .refine((messages) => messages.filter((message) => message.role === "user").every((message) => message.text.length <= 4000)),
}).strict();

const responseSchema = z.object({
  promptFeedback: z.object({ blockReason: z.string().optional() }).optional(),
  candidates: z.array(z.object({
    finishReason: z.string().optional(),
    content: z.object({
      parts: z.array(z.object({ text: z.string().optional(), thought: z.boolean().optional() })),
    }).optional(),
  })).optional(),
});

const providerErrorSchema = z.object({
  error: z.object({
    details: z.array(z.object({ reason: z.string().optional() })).optional(),
  }),
});

async function providerError(response: Response): Promise<AppError> {
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    return new AppError("GEMINI_INVALID_RESPONSE", 502);
  }
  const parsed = providerErrorSchema.safeParse(value);
  const reasons = parsed.success ? parsed.data.error.details?.map((detail) => detail.reason) ?? [] : [];
  // Only return fixed application codes; provider messages can contain secrets.
  if (reasons.some((reason) => ["API_KEY_INVALID", "API_KEY_EXPIRED"].includes(reason ?? "")) || response.status === 401) {
    return new AppError("GEMINI_KEY_INVALID", 503);
  }
  if (reasons.includes("SERVICE_DISABLED")) return new AppError("GEMINI_API_DISABLED", 503);
  if (response.status === 404) return new AppError("GEMINI_MODEL_UNAVAILABLE", 503);
  if (response.status === 403) return new AppError("GEMINI_ACCESS_DENIED", 503);
  return new AppError("GEMINI_REQUEST_REJECTED", 503);
}

const cooldowns = new Map<string, number>();
export function reserveCoachRequest(sessionId: string, now = Date.now()) {
  for (const [id, expires] of cooldowns) if (expires <= now) cooldowns.delete(id);
  if (cooldowns.has(sessionId) || cooldowns.size >= 1000) throw new AppError("COACH_RATE_LIMITED", 429);
  cooldowns.set(sessionId, now + 10_000);
}

export async function geminiReply(input: unknown, fetcher: typeof fetch = fetch) {
  const parsed = chatInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_INPUT");
  const apiKey = geminiApiKey();
  if (!apiKey) throw new AppError("GEMINI_NOT_CONFIGURED", 503);
  const model = process.env.GEMINI_MODEL?.trim() || "gemini-2.5-flash-lite";
  if (!/^gemini-[a-z0-9.-]+$/.test(model)) throw new AppError("GEMINI_INVALID_CONFIG", 503);
  const { fields, language, messages } = parsed.data;
  let response: Response;
  try {
    response = await fetcher(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: coachingContext({ ...emptyIdea(), ...fields }, language) }] },
        contents: messages.map(({ role, text }) => ({ role, parts: [{ text }] })),
        generationConfig: { maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } },
      }),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      throw new AppError("GEMINI_TIMEOUT", 504);
    }
    // Do not log provider errors: they can contain credentials or prompt data.
    throw new AppError("GEMINI_UNAVAILABLE", 502);
  }
  if (response.status === 429) throw new AppError("GEMINI_QUOTA_EXCEEDED", 429);
  if ([400, 401, 403, 404].includes(response.status)) throw await providerError(response);
  if (!response.ok) throw new AppError("GEMINI_UNAVAILABLE", 502);
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new AppError("GEMINI_INVALID_RESPONSE", 502);
  }
  const result = responseSchema.safeParse(value);
  if (!result.success) throw new AppError("GEMINI_INVALID_RESPONSE", 502);
  const candidate = result.data.candidates?.[0];
  if (result.data.promptFeedback?.blockReason || candidate?.finishReason === "SAFETY") {
    throw new AppError("GEMINI_BLOCKED", 422);
  }
  if (candidate?.finishReason === "MAX_TOKENS") throw new AppError("GEMINI_TRUNCATED", 502);
  if (candidate?.finishReason !== "STOP") throw new AppError("GEMINI_INVALID_RESPONSE", 502);
  const text = candidate.content?.parts.filter((part) => !part.thought).map((part) => part.text ?? "").join("").trim();
  if (!text || text.length > 6000) throw new AppError("GEMINI_INVALID_RESPONSE", 502);
  return { content: text, ...parseCoachReply(text) };
}
