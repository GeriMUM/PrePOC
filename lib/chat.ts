import { z } from "zod";
import { AppError } from "./errors";
import { ideaFieldsSchema } from "./model";
import { text } from "./text";

export const chatMessageSchema = z.object({
  role: z.enum(["user", "model"]),
  text: text(6000, 1),
}).strict();
export type ChatMessage = z.infer<typeof chatMessageSchema>;

/** One coach request from the browser: the visible conversation plus our signed Copilot conversation token. */
export const chatInputSchema = z.object({
  language: z.enum(["en", "de"]),
  fields: ideaFieldsSchema.pick({ title: true, problem: true }).strict(),
  messages: z.array(chatMessageSchema).min(1).max(11)
    .refine((messages) => messages.length % 2 === 1 &&
      messages.every((message, index) => message.role === (index % 2 === 0 ? "user" : "model")),
    "Expected alternating turns ending with a user message")
    .refine((messages) => messages.reduce((length, message) => length + message.text.length, 0) <= 10_000)
    .refine((messages) => messages.filter((message) => message.role === "user").every((message) => message.text.length <= 4000)),
  conversation: z.string().max(4000).optional(),
}).strict();

// A per-instance pause between messages; the durable daily budgets live in lib/quota.ts.
const cooldowns = new Map<string, number>();
export function reserveCoachRequest(sessionId: string, now = Date.now()) {
  for (const [id, expires] of cooldowns) if (expires <= now) cooldowns.delete(id);
  if (cooldowns.has(sessionId)) throw new AppError("COACH_RATE_LIMITED", 429);
  cooldowns.set(sessionId, now + 3_000);
}
/** A failed request should not block the immediate retry. */
export function releaseCoachRequest(sessionId: string) {
  cooldowns.delete(sessionId);
}
