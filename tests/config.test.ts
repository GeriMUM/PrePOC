import assert from "node:assert/strict";
import { test } from "node:test";
import { errorMessage, messages } from "../lib/i18n";

test("both interface languages have matching non-empty messages", () => {
  assert.deepEqual(Object.keys(messages.en), Object.keys(messages.de));
  assert.ok(Object.values(messages.en).every(Boolean));
  assert.ok(Object.values(messages.de).every(Boolean));
  assert.notEqual(errorMessage("CONFLICT", "en"), errorMessage("CONFLICT", "de"));
  assert.ok(errorMessage("unknown", "en"));
});

test("every limit and storage error code has its own message in both languages", () => {
  for (const code of ["RATE_LIMITED", "IDEA_LIMIT", "COMMENT_LIMIT", "COMMENT_DUPLICATE", "LIKE_BUSY", "LIKE_LIMIT", "COACH_BUDGET", "STORAGE_BUSY", "OWN_IDEA"]) {
    for (const language of ["en", "de"] as const) assert.notEqual(errorMessage(code, language), errorMessage("SERVER_ERROR", language));
  }
});
