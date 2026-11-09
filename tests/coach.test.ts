import assert from "node:assert/strict";
import { test } from "node:test";
import { extractSummary, parseCoachReply, summaryRequest } from "../lib/coach";

test("a plain reply stays conversational; a structured summary is separated for review", () => {
  assert.deepEqual(parseCoachReply("Who would this help?"), { text: "Who would this help?" });
  assert.deepEqual(parseCoachReply('Here is a starting point.\n```idea-summary\n{"title":"Time booking","problem":"Manual effort"}\n```'), {
    text: "Here is a starting point.",
    summary: { title: "Time booking", problem: "Manual effort" },
  });
});

test("fields the workshop never shows are dropped instead of being published unseen", () => {
  assert.deepEqual(parseCoachReply('Starting point.\n```idea-summary\n{"title":"Time booking","approach":"Suggest, review, save","impact":"Hours saved"}\n```'), {
    text: "Starting point.",
    summary: { title: "Time booking" },
  });
  const onlyHidden = 'Review.\n```idea-summary\n{"approach":"Suggest, review, save"}\n```';
  assert.deepEqual(parseCoachReply(onlyHidden), { text: onlyHidden, invalidSummary: true });
});

test("a summary labelled as json followed by idea-summary is still recognised", () => {
  for (const fence of ["```json\nidea-summary\n", "```json idea-summary\n", "```idea-summary\r\n"]) {
    assert.deepEqual(parseCoachReply(`Next question?\n\n${fence}{"title":"Briefing","problem":"Tracking takes time"}\n\`\`\``), {
      text: "Next question?",
      summary: { title: "Briefing", problem: "Tracking takes time" },
    });
  }
});

test("invalid or oversized agent output cannot overwrite the idea summary or its ownership metadata", () => {
  for (const value of [
    '{"ownerId":"someone-else"}', '{"author":"Impersonated"}', '{"problem":123}', '{"eventId":"coffee-2"}',
    "not-json", "{}", "[]", JSON.stringify({ title: "x".repeat(121) }),
  ]) {
    const text = `Please review.\n\`\`\`idea-summary\n${value}\n\`\`\``;
    const result = parseCoachReply(text);
    assert.equal(result.invalidSummary, true);
    assert.equal(result.summary, undefined);
    assert.equal(result.text, text);
  }
});

test("the move-to-form summary is read from plain JSON, fenced JSON or JSON with surrounding text", () => {
  assert.deepEqual(extractSummary('{"title":"Wochenreport","problem":"Freitags Zahlen sammeln dauert."}'), { title: "Wochenreport", problem: "Freitags Zahlen sammeln dauert." });
  assert.deepEqual(extractSummary('Gern!\n```json\n{"title":"Wochenreport"}\n```'), { title: "Wochenreport" });
  assert.deepEqual(extractSummary('```idea-summary\n{"problem":"Slow"}\n```'), { problem: "Slow" });
  assert.equal(extractSummary(`{"title":"${"x".repeat(200)}"}`)?.title?.length, 120);
  for (const bad of ["Keine Ahnung.", "{}", "[1,2]", '{"author":"Boss"}', '{"title": 5}', "{not json}"]) assert.equal(extractSummary(bad), null);
  // Only title and problem ever reach the form.
  assert.deepEqual(extractSummary('{"title":"T","ownerId":"x","approach":"A"}'), { title: "T" });
  assert.match(summaryRequest("de"), /ausschließlich mit einem JSON-Objekt/);
  assert.match(summaryRequest("en"), /only with a JSON object/);
});
