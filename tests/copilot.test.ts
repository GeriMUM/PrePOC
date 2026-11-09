import assert from "node:assert/strict";
import { test } from "node:test";
import { coachName, coachProvider } from "../lib/coach-config";
import { composeMessage, copilotReply, directLineEndpoints, replyBudget } from "../lib/copilot";
import { AppError } from "../lib/errors";
import { errorMessage } from "../lib/i18n";
import { verify } from "../lib/tokens";

const secret = "direct-line-secret-not-real";
const userId = "99999999-8888-7777-6666-555555555555";
const input = {
  language: "de",
  fields: { title: "Zeiterfassung", problem: "Buchen dauert zu lange." },
  messages: [{ role: "user", text: "Hilf mir, die Zeiterfassung zu vereinfachen." }],
};
const hasCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;

/** A fake Direct Line service: records calls, answers like Copilot Studio would. */
function directLine(reply: string | string[] = "Welche Aufgabe nervt am meisten?", behaviour: { startStatus?: number; sendStatus?: number; greeting?: string; silent?: boolean; region?: string } = {}) {
  const calls: { method: string; url: string; body?: unknown; auth: string | null }[] = [];
  const conversations = new Map<string, { activities: unknown[] }>();
  let created = 0;
  const fetcher = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? "GET";
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body, auth: headers.get("authorization") });
    if (headers.get("authorization") !== `Bearer ${secret}`) return Response.json({ error: "bad secret" }, { status: 403 });
    // Like Copilot Studio, the agent answers only from its own region.
    if (behaviour.region && !url.startsWith(`https://${behaviour.region}.directline.botframework.com/`)) return Response.json({ error: "wrong region" }, { status: 403 });
    if (method === "POST" && url.endsWith("/conversations")) {
      if (behaviour.startStatus) return Response.json({}, { status: behaviour.startStatus });
      const id = `conv-${++created}`;
      conversations.set(id, { activities: behaviour.greeting ? [{ type: "message", from: { id: "bot", role: "bot" }, text: behaviour.greeting }] : [] });
      return Response.json({ conversationId: id, token: "t", expires_in: 1800 }, { status: 201 });
    }
    const match = /\/conversations\/([^/?]+)\/activities(?:\?watermark=(\d+))?$/.exec(url);
    const conversation = match && conversations.get(decodeURIComponent(match[1]));
    if (!match || !conversation) return Response.json({}, { status: 404 });
    if (method === "POST") {
      if (behaviour.sendStatus) return Response.json({}, { status: behaviour.sendStatus });
      conversation.activities.push({ type: "message", ...body });
      const sentId = `${match[1]}|${conversation.activities.length}`;
      // A greeting that arrives late, tagged as reply to nothing we sent, must not be mixed in.
      if (behaviour.greeting) conversation.activities.push({ type: "message", from: { id: "bot", role: "bot" }, text: "Late greeting", replyToId: "conversation-start" });
      if (!behaviour.silent) {
        conversation.activities.push({ type: "typing", from: { id: "bot", role: "bot" } });
        const texts = Array.isArray(reply) ? reply : [reply];
        texts.forEach((text, index) => conversation.activities.push({
          type: "message", from: { id: "bot", role: "bot" }, text, replyToId: sentId, inputHint: index < texts.length - 1 ? "ignoringInput" : "acceptingInput",
        }));
      }
      return Response.json({ id: sentId });
    }
    const watermark = match[2] ? Number(match[2]) : 0;
    return Response.json({ activities: conversation.activities.slice(watermark), watermark: String(conversation.activities.length) });
  }) as unknown as typeof fetch;
  return { fetcher, calls, conversations };
}

let clock = 1_700_000_000_000;
const options = (fetcher: typeof fetch) => ({ fetcher, now: () => clock, sleep: async (ms: number) => { clock += ms; } });

test("the first message starts a conversation, carries the draft as context and a pseudonym, and returns a resumable token", async () => {
  const line = directLine('Wer ist betroffen?\n```idea-summary\n{"title":"Zeiterfassung ohne Aufwand"}\n```', { greeting: "Hallo! Ich bin dein Coach." });
  const reply = await copilotReply(input, secret, userId, options(line.fetcher));
  assert.equal(reply.text, "Wer ist betroffen?");
  assert.deepEqual(reply.summary, { title: "Zeiterfassung ohne Aufwand" });
  assert.doesNotMatch(reply.content, /Hallo! Ich bin dein Coach|Late greeting/);
  const sent = line.calls.find((call) => call.method === "POST" && call.url.includes("/activities"))?.body as { from: { id: string }; text: string; locale: string };
  assert.ok(!sent.from.id.includes(userId) && sent.from.id.length >= 16);
  assert.match(sent.text, /^Hilf mir, die Zeiterfassung zu vereinfachen\.\n\n---\nKontext/);
  assert.match(sent.text, /Titel: Zeiterfassung\nProblem: Buchen dauert zu lange\./);
  assert.equal(sent.locale, "de-DE");
  assert.ok(line.calls.every((call) => call.auth === `Bearer ${secret}`));
  const state = verify("coach", reply.conversation) as { c: string; u: string };
  assert.equal(state.c, "conv-1");
  assert.ok(!JSON.stringify(state).includes(userId));

  // The next message continues the same conversation without creating a new one.
  const second = await copilotReply({ ...input, messages: [...input.messages, { role: "model", text: "Wer ist betroffen?" }, { role: "user", text: "Alle im Team." }], conversation: reply.conversation }, secret, userId, options(line.fetcher));
  assert.equal(line.conversations.size, 1);
  assert.equal((verify("coach", second.conversation) as { c: string }).c, "conv-1");
  assert.equal(line.calls.filter((call) => call.method === "POST" && call.url.endsWith("/conversations")).length, 1);
});

test("a conversation token of another user or a vanished conversation leads to a fresh conversation", async () => {
  const line = directLine();
  const first = await copilotReply(input, secret, userId, options(line.fetcher));
  await copilotReply({ ...input, conversation: first.conversation }, secret, "other-user-id", options(line.fetcher));
  assert.equal(line.conversations.size, 2);
  line.conversations.delete("conv-1");
  const resumed = await copilotReply({ ...input, conversation: first.conversation }, secret, userId, options(line.fetcher));
  assert.equal((verify("coach", resumed.conversation) as { c: string }).c, "conv-3");
});

test("multi-part replies are joined; a silent agent is a timeout; rejected secrets and exhausted capacity are explicit", async () => {
  const joined = await copilotReply(input, secret, userId, options(directLine(["Erster Teil.", "Zweiter Teil."]).fetcher));
  assert.equal(joined.text, "Erster Teil.\n\nZweiter Teil.");
  await assert.rejects(copilotReply(input, secret, userId, options(directLine("x", { silent: true }).fetcher)), hasCode("COPILOT_TIMEOUT"));
  await assert.rejects(copilotReply(input, "wrong-secret", userId, options(directLine().fetcher)), hasCode("COPILOT_REJECTED"));
  await assert.rejects(copilotReply(input, secret, userId, options(directLine("x", { startStatus: 429 }).fetcher)), hasCode("COPILOT_QUOTA"));
  await assert.rejects(copilotReply(input, secret, userId, options(directLine("x", { startStatus: 500 }).fetcher)), hasCode("COPILOT_UNAVAILABLE"));
  await assert.rejects(copilotReply({ ...input, language: "fr" }, secret, userId, options(directLine().fetcher)), hasCode("INVALID_INPUT"));
  await assert.rejects(copilotReply(input, secret, userId, options((async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch)), hasCode("COPILOT_UNAVAILABLE"));
});

test("a European agent is found on its regional endpoint, remembered, and resumed there", async () => {
  delete (globalThis as { __ccDirectLineEndpoint?: string }).__ccDirectLineEndpoint;
  const line = directLine("Servus!", { region: "europe" });
  const india = directLine("Namaste!", { region: "india" });
  const fromIndia = await copilotReply(input, secret, userId, options(india.fetcher));
  assert.equal(fromIndia.text, "Namaste!");
  assert.deepEqual(india.calls.filter((call) => call.method === "POST" && call.url.endsWith("/conversations")).map((call) => new URL(call.url).host), ["europe.directline.botframework.com", "directline.botframework.com", "india.directline.botframework.com"]);
  delete (globalThis as { __ccDirectLineEndpoint?: string }).__ccDirectLineEndpoint;
  const reply = await copilotReply(input, secret, userId, options(line.fetcher));
  assert.equal(reply.text, "Servus!");
  const starts = line.calls.filter((call) => call.method === "POST" && call.url.endsWith("/conversations")).map((call) => new URL(call.url).host);
  assert.deepEqual(starts, ["europe.directline.botframework.com"]);
  assert.equal((verify("coach", reply.conversation) as { b: string }).b, "https://europe.directline.botframework.com");
  assert.equal(directLineEndpoints({})[0], "https://europe.directline.botframework.com");
  const again = await copilotReply({ ...input, conversation: reply.conversation }, secret, userId, options(line.fetcher));
  assert.ok(again.text);
  assert.ok(line.calls.slice(-3).every((call) => call.url.startsWith("https://europe.")));
  assert.deepEqual(directLineEndpoints({ COPILOT_DIRECT_LINE_URL: "https://india.directline.botframework.com/" }), ["https://india.directline.botframework.com"]);
  assert.throws(() => directLineEndpoints({ COPILOT_DIRECT_LINE_URL: "https://evil.example/directline.botframework.com" }), hasCode("COPILOT_INVALID_CONFIG"));
  delete (globalThis as { __ccDirectLineEndpoint?: string }).__ccDirectLineEndpoint;
});

test("the draft context is appended only when there is one, in the employee's language", () => {
  assert.equal(composeMessage("Hallo", { title: "", problem: "  " }, "de"), "Hallo");
  assert.match(composeMessage("Hi", { title: "Booking", problem: "Slow" }, "en"), /Context \(the employee's current draft in the form\):\nTitle: Booking\nProblem: Slow$/);
  assert.equal(composeMessage("Hi", { title: "", problem: "x".repeat(700) }, "en").length, "Hi\n\n---\nContext (the employee's current draft in the form):\nTitle: –\nProblem: ".length + 600);
});

test("the coach provider follows the configured credentials and an explicit choice", () => {
  assert.equal(coachProvider({}), null);
  assert.equal(coachProvider({ COPILOT_DIRECT_LINE_SECRET: "s" }), "copilot");
  assert.equal(coachProvider({ COPILOT_DIRECT_LINE_SECRET: "s", COACH_PROVIDER: "gemini", GEMINI_API_KEY: "" }), geminiProviderOrNull());
  assert.equal(coachProvider({ COACH_PROVIDER: "copilot" }), null);
  assert.equal(coachName("copilot"), "Copilot");
  assert.equal(coachName("gemini"), "Gemini");
  assert.equal(coachName(null), "Coach");
  for (const code of ["COACH_NOT_CONFIGURED", "COACH_TIMEOUT", "COPILOT_REJECTED", "COPILOT_QUOTA", "COPILOT_TIMEOUT", "COPILOT_UNAVAILABLE", "COPILOT_INVALID_RESPONSE", "COPILOT_INVALID_CONFIG"]) {
    for (const language of ["en", "de"] as const) assert.notEqual(errorMessage(code, language), errorMessage("SERVER_ERROR", language));
  }
});

// Gemini's key is read from process.env, so the expectation depends on the test environment.
function geminiProviderOrNull() {
  return process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim() ? "gemini" : null;
}

test("a silent agent ends within the time budget with a bounded number of polls", async () => {
  const line = directLine("x", { silent: true, region: "europe" });
  const startedAt = clock;
  await assert.rejects(copilotReply(input, secret, userId, options(line.fetcher)), hasCode("COPILOT_TIMEOUT"));
  assert.ok(clock - startedAt <= replyBudget, `took ${clock - startedAt} ms`);
  const polls = line.calls.filter((call) => call.method === "GET").length;
  // About 200 reads in the worst case; reads cost no tokens.
  assert.ok(polls <= 210, `${polls} polls`);
});

test("a very slow Direct Line service cannot push the reply past the time budget", async () => {
  const fast = directLine("Antwort", { region: "europe" });
  // Every request takes 100 s; the budget must cut the whole exchange off, not each request.
  const perRequest = 100_000;
  const slow = (async (url: string, init?: RequestInit) => { clock += perRequest; return fast.fetcher(url, init); }) as unknown as typeof fetch;
  const startedAt = clock;
  await assert.rejects(copilotReply(input, secret, userId, options(slow)), hasCode("COPILOT_TIMEOUT"));
  // No request starts after the budget; the last one may still run (in production its abort signal caps it at 10 s).
  assert.ok(clock - startedAt <= replyBudget + perRequest, `took ${clock - startedAt} ms`);
  assert.ok(fast.calls.length <= 3, `${fast.calls.length} requests`);
});

test("an all-invisible reply is refused and a refused resumed conversation is replaced once", async () => {
  delete (globalThis as { __ccDirectLineEndpoint?: string }).__ccDirectLineEndpoint;
  await assert.rejects(copilotReply(input, secret, userId, options(directLine("\u200B\u2060", { region: "europe" }).fetcher)), hasCode("COPILOT_INVALID_RESPONSE"));
  const line = directLine("Weiter geht's.", { region: "europe" });
  const first = await copilotReply(input, secret, userId, options(line.fetcher));
  // Microsoft no longer accepts the old conversation (e.g. secret regenerated): exactly one fresh start.
  line.conversations.delete("conv-1");
  const next = await copilotReply({ ...input, conversation: first.conversation }, secret, userId, options(line.fetcher));
  assert.equal(next.text, "Weiter geht's.");
  assert.equal(line.calls.filter((call) => call.method === "POST" && call.url.endsWith("/conversations")).length, 2);
});

test("the route's deadline shortens the budget, so storage work before the call counts too", async () => {
  const line = directLine("x", { silent: true, region: "europe" });
  const startedAt = clock;
  await assert.rejects(copilotReply(input, secret, userId, { ...options(line.fetcher), deadline: clock + 5_000 }), hasCode("COPILOT_TIMEOUT"));
  assert.ok(clock - startedAt <= 5_000, `took ${clock - startedAt} ms`);
});
