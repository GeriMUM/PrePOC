import { z } from "zod";
import { parseCoachReply } from "./coach";
import { AppError } from "./errors";
import { chatInputSchema } from "./gemini";
import type { Language } from "./model";
import { clean } from "./text";
import { digest, sign, verify } from "./tokens";

/**
 * Talks to a Microsoft Copilot Studio agent over the Direct Line 3.0 REST API, server-side only.
 * The Direct Line secret never leaves the server; the browser only ever sees our own signed
 * conversation token, so nobody can write into someone else's conversation.
 */
// Copilot Studio serves Direct Line from the region of its environment; the first endpoint that
// accepts the secret is remembered. COPILOT_DIRECT_LINE_URL pins one explicitly.
// Europe first: this company's environment lives there, and every refused try costs a round trip.
const regions = ["https://europe.directline.botframework.com", "https://directline.botframework.com", "https://india.directline.botframework.com"];
const endpointState = globalThis as { __ccDirectLineEndpoint?: string };
export function directLineEndpoints(env: Record<string, string | undefined> = process.env): string[] {
  const configured = env.COPILOT_DIRECT_LINE_URL?.trim().replace(/\/+$/, "");
  if (!configured) return endpointState.__ccDirectLineEndpoint ? [endpointState.__ccDirectLineEndpoint, ...regions.filter((region) => region !== endpointState.__ccDirectLineEndpoint)] : regions;
  if (!/^https:\/\/[a-z0-9.-]*directline\.botframework\.com$/.test(configured)) throw new AppError("COPILOT_INVALID_CONFIG", 503);
  return [configured];
}
export const conversationMaxAge = 2 * 60 * 60;
// Generous on purpose (long questions may take a while), but just inside the route's maxDuration, so
// a silent agent ends with a clean COPILOT_TIMEOUT instead of the platform cutting the function off.
export const replyBudget = 290_000;
// No single Direct Line request may take longer than this.
const callTimeout = 10_000;
// Poll quickly at first (short answers arrive within a second or two), then once a second. Polls only read; they cost no tokens.
// Worst case (agent silent for the whole budget): about 200 reads.
const pollDelay = (poll: number) => poll < 8 ? 250 : poll < 24 ? 500 : poll < 84 ? 1_000 : 2_000;
const maxReply = 6_000;

const startSchema = z.object({ conversationId: z.string().min(1).max(200) });
const activitySchema = z.object({
  type: z.string(),
  from: z.object({ id: z.string(), role: z.string().optional() }).optional(),
  text: z.string().optional(),
  inputHint: z.string().optional(),
  replyToId: z.string().optional(),
});
const activitiesSchema = z.object({ activities: z.array(activitySchema), watermark: z.string().max(200).optional() });
const stateSchema = z.object({ c: z.string().min(1).max(200), u: z.string(), w: z.string().max(200).optional(), b: z.string().max(200), exp: z.number() });

export interface CopilotOptions {
  /** Absolute end of the time budget, set by the route at request start so storage work counts too. */
  deadline?: number;
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
  constructor(private secret: string, private fetcher: typeof fetch, readonly base: string, private remaining: () => number) {}

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const left = this.remaining();
    if (left <= 0) throw new AppError("COPILOT_TIMEOUT", 504);
    try {
      return await this.fetcher(`${this.base}/v3/directline${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.secret}`, "Content-Type": "application/json" },
        cache: "no-store", redirect: "error", signal: AbortSignal.timeout(Math.max(1, Math.min(callTimeout, left))),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) throw new AppError("COPILOT_TIMEOUT", 504);
      // Never log the error: it may carry the request with the secret.
      throw new AppError("COPILOT_UNAVAILABLE", 502);
    }
  }

  /** Starts a conversation; null when this endpoint refuses the secret (wrong region or unpublished agent). */
  async start(): Promise<string | null> {
    const response = await this.call("/conversations", { method: "POST" });
    if (response.status === 401 || response.status === 403) {
      // Status and host only, never the body or the secret: visible in the Vercel logs for diagnosis.
      console.warn(`Direct Line ${new URL(this.base).host} refused the secret (HTTP ${response.status})`);
      return null;
    }
    if (!response.ok) throw failure(response.status);
    const parsed = startSchema.safeParse(await readJson(response));
    if (!parsed.success) throw new AppError("COPILOT_INVALID_RESPONSE", 502);
    return parsed.data.conversationId;
  }

  /** Returns the sent activity's id, or null when the conversation no longer exists, so the caller can start a fresh one. */
  async send(conversationId: string, from: string, text: string, locale: string): Promise<string | null> {
    const response = await this.call(`/conversations/${encodeURIComponent(conversationId)}/activities`, {
      method: "POST",
      body: JSON.stringify({ type: "message", from: { id: from, role: "user" }, locale, text, textFormat: "plain" }),
    });
    // Gone, expired or no longer accepted (e.g. after the secret was regenerated): start a fresh conversation once.
    if ([400, 403, 404, 410].includes(response.status)) return null;
    if (!response.ok) throw failure(response.status);
    const sent = z.object({ id: z.string() }).safeParse(await readJson(response));
    return sent.success ? sent.data.id : "";
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
  const from = pseudonym(userId);
  const user = digest("copilot-conversation", userId);
  const endpoints = directLineEndpoints();
  const started = now();
  const budgetEnd = Math.min(options.deadline ?? Infinity, started + replyBudget);
  const remaining = () => budgetEnd - now();
  async function open(): Promise<{ line: DirectLine; c: string }> {
    for (const endpoint of endpoints) {
      const line = new DirectLine(secret, fetcher, endpoint, remaining);
      const c = await line.start();
      if (c) { endpointState.__ccDirectLineEndpoint = endpoint; return { line, c }; }
    }
    throw new AppError("COPILOT_REJECTED", 503);
  }

  // Resume the employee's own conversation when the signed token is valid, otherwise start a new one.
  const previous = stateSchema.safeParse(verify("coach", conversation));
  let state = previous.success && previous.data.u === user && previous.data.exp > now() / 1000 && endpoints.includes(previous.data.b) ? previous.data : null;
  let line = state ? new DirectLine(secret, fetcher, state.b, remaining) : null;
  const text = composeMessage(messages[messages.length - 1].text, fields, language);
  const locale = language === "de" ? "de-DE" : "en-US";
  let isFresh = false;
  async function fresh() {
    const opened = await open();
    line = opened.line; isFresh = true;
    state = { c: opened.c, u: user, w: (await line.activities(opened.c)).watermark, b: line.base, exp: 0 };
  }
  if (!state || !line) await fresh();
  let sentId = await line!.send(state!.c, from, text, locale);
  if (sentId === null) {
    await fresh();
    sentId = await line!.send(state!.c, from, text, locale);
    if (sentId === null) throw new AppError("COPILOT_UNAVAILABLE", 502);
  }
  const active = { line: line!, state: state! };

  // Collect the agent's answer until it signals that it waits for input. Answers carry replyToId = our message;
  // agents that do not tag them fall back to "any agent message", minus an early greeting in fresh conversations.
  const replies: string[] = [];
  let watermark = active.state.w;
  let settled = false;
  let polls = 0;
  // Ends when the agent is done, or when the budget would not even cover the next pause (always finite).
  while (remaining() > pollDelay(polls)) {
    await sleep(pollDelay(polls++));
    const page = await active.line.activities(active.state.c, watermark);
    watermark = page.watermark ?? watermark;
    let waiting = false;
    for (const activity of page.activities) {
      if (activity.type !== "message" || activity.from?.id === from || !activity.text?.trim()) continue;
      // A message tagged as answering something else (e.g. a late greeting) is not part of this reply.
      if (activity.replyToId && sentId && activity.replyToId !== sentId) continue;
      replies.push(activity.text.trim());
      waiting = activity.inputHint !== "ignoringInput";
    }
    if (replies.length && (waiting || settled)) break;
    if (replies.length) settled = true;
  }
  if (!replies.length) throw new AppError("COPILOT_TIMEOUT", 504);
  // Timing only, never content: shows in the Vercel logs where the seconds go.
  console.info(`Copilot reply in ${now() - started} ms (${polls} polls, ${isFresh ? "new" : "resumed"} conversation, ${new URL(active.state.b).host})`);
  // Cleaned like user input, so an all-invisible reply cannot poison the next turn's history.
  const content = clean(replies.join("\n\n")).slice(0, maxReply);
  if (!content) throw new AppError("COPILOT_INVALID_RESPONSE", 502);
  const token = sign("coach", { c: active.state.c, u: user, w: watermark, b: active.state.b, exp: Math.floor(now() / 1000) + conversationMaxAge });
  return { content, ...parseCoachReply(content), conversation: token };
}
