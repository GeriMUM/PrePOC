import { z } from "zod";
import { parseCoachReply } from "./coach";
import { AppError } from "./errors";
import { chatInputSchema } from "./gemini";
import type { Language } from "./model";
import { digest, sign, verify } from "./tokens";

/**
 * Talks to a Microsoft Copilot Studio agent over the Direct Line 3.0 REST API, server-side only.
 * The Direct Line secret never leaves the server; the browser only ever sees our own signed
 * conversation token, so nobody can write into someone else's conversation.
 */
const base = "https://directline.botframework.com/v3/directline";
export const conversationMaxAge = 2 * 60 * 60;
const replyDeadline = 45_000;
const pollInterval = 1_000;
const settleTime = 1_200;
const maxReply = 6_000;

const startSchema = z.object({ conversationId: z.string().min(1).max(200) });
const activitySchema = z.object({
  type: z.string(),
  from: z.object({ id: z.string(), role: z.string().optional() }).optional(),
  text: z.string().optional(),
  inputHint: z.string().optional(),
});
const activitiesSchema = z.object({ activities: z.array(activitySchema), watermark: z.string().max(200).optional() });
const stateSchema = z.object({ c: z.string().min(1).max(200), u: z.string(), w: z.string().max(200).optional(), exp: z.number() });

export interface CopilotOptions {
  fetcher?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

/** What the agent sees instead of the account id. */
const pseudonym = (userId: string) => digest("copilot-user", userId).slice(0, 32);

function failure(status: number): AppError {
  if (status === 401 || status === 403) return new AppError("COPILOT_REJECTED", 503);
  if (status === 429) return new AppError("COPILOT_QUOTA", 429);
  return new AppError("COPILOT_UNAVAILABLE", 502);
}

async function readJson(response: Response, maxBytes = 1_000_000): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

/** The employee's message plus the current draft as context the agent's instructions know how to read. */
export function composeMessage(message: string, fields: { title: string; problem: string }, language: Language) {
  const title = fields.title.trim(), problem = fields.problem.trim().slice(0, 600);
  if (!title && !problem) return message;
  const label = language === "de" ? ["Kontext (aktueller Entwurf der Idee im Formular)", "Titel", "Problem"] : ["Context (the employee's current draft in the form)", "Title", "Problem"];
  return `${message}\n\n---\n${label[0]}:\n${label[1]}: ${title || "–"}\n${label[2]}: ${problem || "–"}`;
}

class DirectLine {
  constructor(private secret: string, private fetcher: typeof fetch) {}

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    try {
      return await this.fetcher(`${base}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.secret}`, "Content-Type": "application/json" },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new AppError("COPILOT_TIMEOUT", 504);
      // Never log the error: it may carry the request with the secret.
      throw new AppError("COPILOT_UNAVAILABLE", 502);
    }
  }

  async start(): Promise<string> {
    const response = await this.call("/conversations", { method: "POST" });
    if (!response.ok) throw failure(response.status);
    const parsed = startSchema.safeParse(await readJson(response));
    if (!parsed.success) throw new AppError("COPILOT_INVALID_RESPONSE", 502);
    return parsed.data.conversationId;
  }

  /** Returns false when the conversation no longer exists, so the caller can start a fresh one. */
  async send(conversationId: string, from: string, text: string, locale: string): Promise<boolean> {
    const response = await this.call(`/conversations/${encodeURIComponent(conversationId)}/activities`, {
      method: "POST",
      body: JSON.stringify({ type: "message", from: { id: from, role: "user" }, locale, text, textFormat: "plain" }),
    });
    if (response.status === 404 || response.status === 410) return false;
    if (!response.ok) throw failure(response.status);
    return true;
  }

  async activities(conversationId: string, watermark?: string) {
    const query = watermark ? `?watermark=${encodeURIComponent(watermark)}` : "";
    const response = await this.call(`/conversations/${encodeURIComponent(conversationId)}/activities${query}`);
    if (!response.ok) throw failure(response.status);
    const parsed = activitiesSchema.safeParse(await readJson(response));
    if (!parsed.success) throw new AppError("COPILOT_INVALID_RESPONSE", 502);
    return parsed.data;
  }
}

export async function copilotReply(input: unknown, secret: string, userId: string, options: CopilotOptions = {}) {
  const parsed = chatInputSchema.safeParse(input);
  if (!parsed.success) throw new AppError("INVALID_INPUT");
  const { fetcher = fetch, now = Date.now, sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) } = options;
  const { fields, language, messages, conversation } = parsed.data;
  const line = new DirectLine(secret, fetcher);
  const from = pseudonym(userId);
  const user = digest("copilot-conversation", userId);

  // Resume the employee's own conversation when the signed token is valid, otherwise start a new one.
  const previous = stateSchema.safeParse(verify("coach", conversation));
  let state = previous.success && previous.data.u === user && previous.data.exp > now() / 1000 ? previous.data : null;
  const text = composeMessage(messages[messages.length - 1].text, fields, language);
  const locale = language === "de" ? "de-DE" : "en-US";
  if (!state) {
    const c = await line.start();
    // Let a greeting the agent may send at conversation start pass by, so it is not mixed into the reply.
    await sleep(settleTime);
    state = { c, u: user, w: (await line.activities(c)).watermark, exp: 0 };
  }
  if (!(await line.send(state.c, from, text, locale))) {
    const c = await line.start();
    await sleep(settleTime);
    state = { c, u: user, w: (await line.activities(c)).watermark, exp: 0 };
    if (!(await line.send(state.c, from, text, locale))) throw new AppError("COPILOT_UNAVAILABLE", 502);
  }

  // Collect the agent's messages until it signals that it is waiting for input (and nothing more follows).
  const replies: string[] = [];
  const deadline = now() + replyDeadline;
  let watermark = state.w;
  let settled = false;
  while (now() < deadline) {
    await sleep(pollInterval);
    const page = await line.activities(state.c, watermark);
    watermark = page.watermark ?? watermark;
    let waiting = false;
    for (const activity of page.activities) {
      if (activity.type !== "message" || activity.from?.id === from || !activity.text?.trim()) continue;
      replies.push(activity.text.trim());
      waiting = activity.inputHint !== "ignoringInput";
    }
    if (replies.length && (waiting || settled)) break;
    if (replies.length) settled = true;
  }
  if (!replies.length) throw new AppError("COPILOT_TIMEOUT", 504);
  const content = replies.join("\n\n").slice(0, maxReply);
  const token = sign("coach", { c: state.c, u: user, w: watermark, exp: Math.floor(now() / 1000) + conversationMaxAge });
  return { content, ...parseCoachReply(content), conversation: token };
}
