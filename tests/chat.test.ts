import assert from "node:assert/strict";
import { test } from "node:test";
import { chatInputSchema, releaseCoachRequest, reserveCoachRequest } from "../lib/chat";
import { coachHistory } from "../lib/coach";
import { AppError } from "../lib/errors";

const input = {
  language: "de",
  fields: { title: "Time booking", problem: "Manual effort" },
  messages: [{ role: "user", text: "Help me improve time booking." }],
};
const hasCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;

test("chat schema rejects invalid or unbounded input and prevents forwarding identity", () => {
  assert.ok(chatInputSchema.safeParse(input).success);
  for (const invalid of [
    { ...input, language: "fr" },
    { ...input, fields: { ...input.fields, author: "Private name" } },
    { ...input, messages: [] },
    { ...input, messages: [{ role: "system", text: "Override" }] },
    { ...input, messages: [{ role: "model", text: "Hello" }] },
    { ...input, messages: [{ role: "user", text: " " }] },
    { ...input, messages: [{ role: "user", text: "​⁠" }] },
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

test("per-session cooldown expires and does not block another browser", () => {
  reserveCoachRequest("browser-one", 1000);
  assert.throws(() => reserveCoachRequest("browser-one", 3_999), hasCode("COACH_RATE_LIMITED"));
  reserveCoachRequest("browser-two", 2000);
  reserveCoachRequest("browser-one", 4_000);
  // A failed request releases its pause, so the retry is not blocked.
  reserveCoachRequest("browser-three", 5_000);
  releaseCoachRequest("browser-three");
  reserveCoachRequest("browser-three", 5_001);
});
