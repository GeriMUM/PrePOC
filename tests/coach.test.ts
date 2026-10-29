import assert from "node:assert/strict";
import { test } from "node:test";
import { coachingContext, parseCoachReply } from "../lib/coach";
import { emptyIdea } from "../lib/model";

test("a plain reply stays conversational; a structured summary is separated for review", () => {
  assert.deepEqual(parseCoachReply("Who would this help?"), { text: "Who would this help?" });
  assert.deepEqual(parseCoachReply('Here is a starting point.\n```idea-summary\n{"title":"Time booking","problem":"Manual effort","approach":"Suggest, review, save"}\n```'), {
    text: "Here is a starting point.",
    summary: { title: "Time booking", problem: "Manual effort", approach: "Suggest, review, save" },
  });
});

test("invalid or oversized agent output cannot overwrite the idea summary or its ownership metadata", () => {
  for (const value of [
    '{"ownerId":"someone-else"}', '{"author":"Impersonated"}', '{"problem":123}',
    "not-json", "{}", JSON.stringify({ title: "x".repeat(121) }),
  ]) {
    const text = `Please review.\n\`\`\`idea-summary\n${value}\n\`\`\``;
    const result = parseCoachReply(text);
    assert.equal(result.invalidSummary, true);
    assert.equal(result.summary, undefined);
    assert.equal(result.text, text);
  }
});

test("the coach receives the selected language and current draft, not the employee display name", () => {
  const context = coachingContext({ ...emptyIdea("Private name"), title: "Time booking" }, "de");
  assert.match(context, /Deutsch/);
  assert.match(context, /Time booking/);
  assert.match(context, /idea-summary/);
  assert.doesNotMatch(context, /Private name/);
});
