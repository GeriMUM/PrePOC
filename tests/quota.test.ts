import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AppError } from "../lib/errors";
import { day, Quota } from "../lib/quota";
import { FileStore } from "../lib/storage";

const hasCode = (code: string, status = 429) => (error: unknown) => error instanceof AppError && error.code === code && error.status === status;

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coffee-quota-"));
  const store = new FileStore(directory);
  return { store, quota: new Quota(store), cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("a daily budget counts per subject and bucket, then refuses with HTTP 429", async () => {
  const { store, quota, cleanup } = await setup();
  try {
    const now = Date.parse("2026-11-09T10:00:00Z");
    await quota.consume("chat", "alex", 2, "COACH_BUDGET", now);
    await quota.consume("chat", "alex", 2, "COACH_BUDGET", now);
    await assert.rejects(quota.consume("chat", "alex", 2, "COACH_BUDGET", now), hasCode("COACH_BUDGET"));
    await quota.consume("chat", "sam", 2, "COACH_BUDGET", now);
    await quota.consume("writes", "alex", 1, undefined, now);
    await assert.rejects(quota.consume("writes", "alex", 1, undefined, now), hasCode("RATE_LIMITED"));
    // The next day starts fresh; the store never holds the account id itself.
    await quota.consume("chat", "alex", 2, "COACH_BUDGET", now + 24 * 3600 * 1000);
    const keys = await store.keys(`usage/${day(now)}/chat/`);
    assert.equal(keys.length, 2);
    assert.ok(keys.every((key) => !key.includes("alex") && !key.includes("sam")));
  } finally { await cleanup(); }
});

test("simultaneous requests cannot exceed the budget", async () => {
  const { quota, cleanup } = await setup();
  try {
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => quota.consume("writes", "alex", 3)));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 3);
    assert.ok(results.filter((result) => result.status === "rejected").every((result) => result.status === "rejected" && hasCode("RATE_LIMITED")(result.reason)));
  } finally { await cleanup(); }
});
