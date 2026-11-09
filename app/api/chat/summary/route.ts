import { z } from "zod";
import { api, body } from "../../../../lib/api";
import { extractSummary, summaryRequest } from "../../../../lib/coach";
import { coachProvider, directLineSecret } from "../../../../lib/coach-config";
import { copilotReply } from "../../../../lib/copilot";
import { AppError } from "../../../../lib/errors";
import { chatInputSchema, chatMessageSchema, geminiReply, releaseCoachRequest, reserveCoachRequest } from "../../../../lib/gemini";
import { ideaFieldsSchema } from "../../../../lib/model";
import { Quota } from "../../../../lib/quota";
import { session } from "../../../../lib/session";
import { storage } from "../../../../lib/storage";

export const runtime = "nodejs";
// Long enough that nobody notices; replyBudget ends just before it.
export const maxDuration = 300;

// The conversation so far (ending with the coach's answer); the server adds the summary request itself.
const inputSchema = z.object({
  language: z.enum(["en", "de"]),
  fields: ideaFieldsSchema.pick({ title: true, problem: true }).strict(),
  messages: z.array(chatMessageSchema).min(2).max(10)
    .refine((messages) => messages.length % 2 === 0 &&
      messages.every((message, index) => message.role === (index % 2 === 0 ? "user" : "model")))
    .refine((messages) => messages.reduce((length, message) => length + message.text.length, 0) <= 10_000)
    .refine((messages) => messages.filter((message) => message.role === "user").every((message) => message.text.length <= 4000)),
  conversation: z.string().max(4000).optional(),
}).strict();

/** "Move to form": asks the coach for title and problem of the idea discussed so far. */
export async function POST(request: Request) {
  return api(async () => {
    const deadline = Date.now() + 290_000;
    const owner = await session();
    // Its own pause, so the button works right after the coach answered.
    const key = `${owner.id}:summary`;
    reserveCoachRequest(key);
    try {
      const input = inputSchema.safeParse(await body(request, 96_000));
      if (!input.success) throw new AppError("INVALID_INPUT");
      const provider = coachProvider();
      if (!provider) throw new AppError("COACH_NOT_CONFIGURED", 503);
      const ask = { role: "user" as const, text: summaryRequest(input.data.language) };
      // Drop the oldest pairs until history plus the request fits the chat limits; the agent itself keeps the full conversation.
      let history = input.data.messages;
      while (history.length && history.reduce((length, message) => length + message.text.length, 0) + ask.text.length > 10_000) history = history.slice(2);
      const chat = chatInputSchema.safeParse({ ...input.data, messages: [...history, ask] });
      if (!chat.success) throw new AppError("INVALID_INPUT");
      // Validated before counting, so a malformed request costs no budget.
      await new Quota(storage()).chat(owner.id);
      const reply = provider === "copilot" ? await copilotReply(chat.data, directLineSecret() ?? "", owner.id, { deadline }) : await geminiReply(chat.data);
      const summary = extractSummary(reply.content);
      if (!summary) throw new AppError("COACH_INVALID_SUMMARY", 502);
      return { summary, ...("conversation" in reply ? { conversation: reply.conversation } : {}) };
    } catch (error) {
      releaseCoachRequest(key);
      throw error;
    }
  });
}
