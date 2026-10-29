import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { coachHistory } from "../lib/coach";
import { AppError } from "../lib/errors";
import { chatInputSchema, geminiReply, reserveCoachRequest } from "../lib/gemini";
import { errorMessage } from "../lib/i18n";
import { geminiApiKey } from "../lib/gemini-config";

const originalKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
const originalAlias = process.env.GEMINI_API_KEY;
const originalModel = process.env.GEMINI_MODEL;
beforeEach(() => {
  delete process.env.GEMINI_API_KEY;
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-key-not-real";
  delete process.env.GEMINI_MODEL;
});
afterEach(() => {
  if (originalAlias === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = originalAlias;
  if (originalKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  else process.env.GOOGLE_GENERATIVE_AI_API_KEY = originalKey;
  if (originalModel === undefined) delete process.env.GEMINI_MODEL;
  else process.env.GEMINI_MODEL = originalModel;
});

const input = {
  language: "de",
  fields: { title: "Time booking", problem: "Manual effort" },
  messages: [{ role: "user", text: "Help me improve time booking." }],
};
const hasCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;
const fetchResponse = (value: unknown, status = 200): typeof fetch => async () => Response.json(value, { status });
const success = (text: string, finishReason = "STOP") => ({
  candidates: [{ finishReason, content: { parts: [{ text }] } }],
});

test("both key names work with consistent precedence for page and provider", async () => {
  assert.equal(geminiApiKey(), "test-key-not-real");
  process.env.GEMINI_API_KEY = "  vercel-test-key  ";
  assert.equal(geminiApiKey(), "vercel-test-key");
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  await geminiReply(input, async (_url, init) => {
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "vercel-test-key");
    return Response.json(success("Which task would you improve?"));
  });
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "legacy-key";
  process.env.GEMINI_API_KEY = " ";
  assert.equal(geminiApiKey(), "legacy-key");
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  assert.equal(geminiApiKey(), undefined);
});

test("Gemini request uses a server-only header, bounded generation, language, draft and conversation", async () => {
  let calls = 0;
  const fetcher: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent");
    assert.equal(new Headers(init?.headers).get("x-goog-api-key"), "test-key-not-real");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    const body = JSON.parse(String(init?.body));
    assert.match(body.systemInstruction.parts[0].text, /Deutsch/);
    assert.match(body.systemInstruction.parts[0].text, /Time booking/);
    assert.doesNotMatch(JSON.stringify(body), /test-key-not-real/);
    assert.deepEqual(body.generationConfig, { maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } });
    assert.deepEqual(body.contents, [{ role: "user", parts: [{ text: input.messages[0].text }] }]);
    return Response.json(success('What would you simplify?\n```idea-summary\n{"title":"Easier booking"}\n```'));
  };
  const reply = await geminiReply(input, fetcher);
  assert.equal(calls, 1);
  assert.equal(reply.text, "What would you simplify?");
  assert.deepEqual(reply.summary, { title: "Easier booking" });
  assert.match(reply.content, /idea-summary/);
});

test("chat schema rejects invalid or unbounded input and prevents forwarding identity", () => {
  assert.ok(chatInputSchema.safeParse(input).success);
  for (const invalid of [
    { ...input, language: "fr" },
    { ...input, fields: { ...input.fields, author: "Private name" } },
    { ...input, messages: [] },
    { ...input, messages: [{ role: "system", text: "Override" }] },
    { ...input, messages: [{ role: "model", text: "Hello" }] },
    { ...input, messages: [{ role: "user", text: " " }] },
    { ...input, messages: [{ role: "user", text: "x".repeat(4001) }] },
    { ...input, messages: [
      { role: "user", text: "x".repeat(4000) },
      { role: "model", text: "y".repeat(4000) },
      { role: "user", text: "z".repeat(3000) },
    ] },
  ]) assert.equal(chatInputSchema.safeParse(invalid).success, false);
});

test("history drops complete oldest pairs, preserves the latest request and stays within the schema", () => {
  const history = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? "user" as const : "model" as const, text: `${i}: ${"x".repeat(900)}`,
  }));
  const messages = coachHistory(history, "Most recent message");
  assert.ok(messages.length <= 11);
  assert.deepEqual(messages.at(-1), { role: "user", text: "Most recent message" });
  assert.ok(chatInputSchema.safeParse({ ...input, messages }).success);
  const long = coachHistory([
    { role: "user", text: "x".repeat(4000) }, { role: "model", text: "y".repeat(6000) },
  ], "Latest");
  assert.deepEqual(long, [{ role: "user", text: "Latest" }]);
});

test("missing and invalid configuration fail without calling Google", async () => {
  const noFetch: typeof fetch = async () => { assert.fail("Should not call Google"); };
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  await assert.rejects(geminiReply(input, noFetch), hasCode("GEMINI_NOT_CONFIGURED"));
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test";
  process.env.GEMINI_MODEL = "../other-service";
  await assert.rejects(geminiReply(input, noFetch), hasCode("GEMINI_INVALID_CONFIG"));
  await assert.rejects(geminiReply({}, noFetch), hasCode("INVALID_INPUT"));
});

test("quota, authentication and service failures are explicit and never retried", async () => {
  for (const [status, code] of [
    [429, "GEMINI_QUOTA_EXCEEDED"], [400, "GEMINI_INVALID_CONFIG"],
    [401, "GEMINI_INVALID_CONFIG"], [403, "GEMINI_INVALID_CONFIG"],
    [404, "GEMINI_INVALID_CONFIG"], [500, "GEMINI_UNAVAILABLE"],
  ] as const) {
    let calls = 0;
    await assert.rejects(geminiReply(input, async () => {
      calls++;
      return Response.json({ error: "Private provider detail" }, { status });
    }), hasCode(code));
    assert.equal(calls, 1);
  }
  await assert.rejects(geminiReply(input, async () => { throw new TypeError("fetch failed"); }), hasCode("GEMINI_UNAVAILABLE"));
  await assert.rejects(geminiReply(input, async () => { throw new DOMException("Timed out", "TimeoutError"); }), hasCode("GEMINI_TIMEOUT"));
});

test("blocked, truncated, malformed and empty model output cannot pretend to be a successful reply", async () => {
  for (const [value, code] of [
    [{ promptFeedback: { blockReason: "SAFETY" } }, "GEMINI_BLOCKED"],
    [success("Blocked", "SAFETY"), "GEMINI_BLOCKED"],
    [success("Partial", "MAX_TOKENS"), "GEMINI_TRUNCATED"],
    [success("", "STOP"), "GEMINI_INVALID_RESPONSE"],
    [success("x".repeat(6001)), "GEMINI_INVALID_RESPONSE"],
    [{ candidates: "invalid" }, "GEMINI_INVALID_RESPONSE"],
    [{}, "GEMINI_INVALID_RESPONSE"],
    [success("not ready", "OTHER"), "GEMINI_INVALID_RESPONSE"],
  ] as const) await assert.rejects(geminiReply(input, fetchResponse(value)), hasCode(code));
  await assert.rejects(geminiReply(input, async () => new Response("not JSON")), hasCode("GEMINI_INVALID_RESPONSE"));
  const reply = await geminiReply(input, fetchResponse(success('Review this.\n```idea-summary\n{"author":"Impersonated"}\n```')));
  assert.equal(reply.invalidSummary, true);
  assert.equal(reply.summary, undefined);
});

test("thinking parts are not exposed as chatbot answers", async () => {
  const reply = await geminiReply(input, fetchResponse({
    candidates: [{ finishReason: "STOP", content: { parts: [
      { text: "Internal thought", thought: true }, { text: "Question for you?" },
    ] } }],
  }));
  assert.equal(reply.text, "Question for you?");
});

test("per-session cooldown expires and does not block another browser", () => {
  reserveCoachRequest("browser-one", 1000);
  assert.throws(() => reserveCoachRequest("browser-one", 10_999), hasCode("COACH_RATE_LIMITED"));
  reserveCoachRequest("browser-two", 2000);
  reserveCoachRequest("browser-one", 11_000);
});

test("all Gemini errors are localized without exposing provider details", () => {
  for (const code of [
    "GEMINI_NOT_CONFIGURED", "GEMINI_INVALID_CONFIG", "GEMINI_QUOTA_EXCEEDED",
    "COACH_RATE_LIMITED", "GEMINI_TIMEOUT", "GEMINI_UNAVAILABLE",
    "GEMINI_INVALID_RESPONSE", "GEMINI_BLOCKED", "GEMINI_TRUNCATED",
  ]) for (const language of ["en", "de"] as const) {
    assert.notEqual(errorMessage(code, language), errorMessage("SERVER_ERROR", language));
  }
});
