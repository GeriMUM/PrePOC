import assert from "node:assert/strict";
import { test } from "node:test";
import { coachConfig, coachToken } from "../lib/coach-config";
import { errorMessage, messages } from "../lib/i18n";

test("both interface languages have matching non-empty messages", () => {
  assert.deepEqual(Object.keys(messages.en), Object.keys(messages.de));
  assert.ok(Object.values(messages.en).every(Boolean));
  assert.ok(Object.values(messages.de).every(Boolean));
  assert.notEqual(errorMessage("CONFLICT", "en"), errorMessage("CONFLICT", "de"));
  assert.ok(errorMessage("unknown", "en"));
});

test("Direct Line configuration rejects authenticated conversation URLs and untrusted hosts", () => {
  const endpoint = process.env.COPILOT_STUDIO_TOKEN_ENDPOINT;
  const domain = process.env.COPILOT_DIRECT_LINE_DOMAIN;
  try {
    delete process.env.COPILOT_STUDIO_TOKEN_ENDPOINT;
    delete process.env.COPILOT_DIRECT_LINE_DOMAIN;
    assert.equal(coachConfig(), null);
    process.env.COPILOT_STUDIO_TOKEN_ENDPOINT = "https://example.environment.api.powerplatform.com/powervirtualagents/bots/test/directline/token?api-version=2022-03-01-preview";
    assert.equal(coachConfig()?.domain, "https://directline.botframework.com/v3/directline");
    for (const bad of [
      "http://example.environment.api.powerplatform.com/directline/token",
      "https://example.com/directline/token",
      "https://example.environment.api.powerplatform.com/agenticruntime/authenticated/bots/test/conversations",
    ]) {
      process.env.COPILOT_STUDIO_TOKEN_ENDPOINT = bad;
      assert.throws(coachConfig, /COACH_INVALID_CONFIG/);
    }
  } finally {
    if (endpoint === undefined) delete process.env.COPILOT_STUDIO_TOKEN_ENDPOINT;
    else process.env.COPILOT_STUDIO_TOKEN_ENDPOINT = endpoint;
    if (domain === undefined) delete process.env.COPILOT_DIRECT_LINE_DOMAIN;
    else process.env.COPILOT_DIRECT_LINE_DOMAIN = domain;
  }
});

test("token service checks upstream status/shape and returns only a conversation token and domain", async () => {
  const endpoint = process.env.COPILOT_STUDIO_TOKEN_ENDPOINT;
  const domain = process.env.COPILOT_DIRECT_LINE_DOMAIN;
  try {
    delete process.env.COPILOT_DIRECT_LINE_DOMAIN;
    delete process.env.COPILOT_STUDIO_TOKEN_ENDPOINT;
    await assert.rejects(coachToken(), /COACH_NOT_CONFIGURED/);
    process.env.COPILOT_STUDIO_TOKEN_ENDPOINT = "https://example.environment.api.powerplatform.com/directline/token";
    const result = await coachToken(async () => Response.json({ token: "scoped-token", expires_in: 1800, secret: "never-return" }));
    assert.deepEqual(result, { token: "scoped-token", domain: "https://directline.botframework.com/v3/directline" });
    await assert.rejects(coachToken(async () => Response.json({ bad: true })), /COACH_INVALID_RESPONSE/);
    await assert.rejects(coachToken(async () => new Response("denied", { status: 401 })), /COACH_AUTH_REQUIRED/);
    await assert.rejects(coachToken(async () => { throw new Error("offline"); }), /COACH_CONNECTION_FAILED/);
  } finally {
    if (endpoint === undefined) delete process.env.COPILOT_STUDIO_TOKEN_ENDPOINT;
    else process.env.COPILOT_STUDIO_TOKEN_ENDPOINT = endpoint;
    if (domain === undefined) delete process.env.COPILOT_DIRECT_LINE_DOMAIN;
    else process.env.COPILOT_DIRECT_LINE_DOMAIN = domain;
  }
});
