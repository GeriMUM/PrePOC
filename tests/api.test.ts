import assert from "node:assert/strict";
import { test } from "node:test";
import { body } from "../lib/api";
import { AppError } from "../lib/errors";

const hasCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;
function post(text: string, extra: Record<string, string> = {}) {
  return new Request("http://localhost:3210/api/ideas", {
    method: "POST",
    headers: { host: "127.0.0.1:3210", origin: "http://127.0.0.1:3210", "content-type": "application/json", ...extra },
    body: text,
  });
}

test("JSON body accepts the browser host even when Next internally normalizes localhost", async () => {
  assert.deepEqual(await body(post('{"title":"Test"}')), { title: "Test" });
});

test("JSON body rejects cross-origin requests, bad JSON, wrong content type, and excess size", async () => {
  await assert.rejects(body(post("{}", { origin: "https://other.example" })), hasCode("INVALID_ORIGIN"));
  await assert.rejects(body(post("{")), hasCode("INVALID_INPUT"));
  await assert.rejects(body(post("{}", { "content-type": "text/plain" })), hasCode("INVALID_INPUT"));
  await assert.rejects(body(post(JSON.stringify({ value: "x".repeat(32_000) }))), hasCode("TOO_LARGE"));
});
