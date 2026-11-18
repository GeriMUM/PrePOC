import assert from "node:assert/strict";
import { test } from "node:test";
import { csvCell, ideasCsv, type ExportLabels } from "../lib/export";
import type { Idea } from "../lib/model";

const labels: ExportLabels = {
  title: "Title", author: "Author", likes: "Likes", publishedOn: "Published on", lastEdited: "Last edited", link: "Link", stage: "Status", dueDate: "Target date",
  problem: "Problem", audience: "Audience", solution: "Solution", approach: "Approach", impact: "Impact",
};
const names = { new: "New", in_progress: "In progress", closed: "Closed" } as const;
const idea: Idea = {
  id: "0b6f7a1e-5b4e-4d4c-9b5e-1a2b3c4d5e6f", title: 'Time "booking"', author: "Alex Example", dueDate: "2027-01-15", stage: "in_progress",
  problem: "=HYPERLINK(\"https://evil.example\")", audience: "line one\nline two", solution: "-5 minutes", approach: "", impact: "@sum",
  status: "published", createdAt: "2026-11-08T09:00:00.000Z", publishedAt: "2026-11-09T10:00:00.000Z", updatedAt: "2026-11-10T11:00:00.000Z", likes: 3, liked: false, mine: false, manage: false,
};

test("cells are quoted, quotes doubled, and spreadsheet formulas neutralised", () => {
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell("=1+1"), "\"'=1+1\"");
  assert.equal(csvCell("+1"), "\"'+1\"");
  assert.equal(csvCell("@cmd"), "\"'@cmd\"");
  assert.equal(csvCell(3), '"3"');
  assert.equal(csvCell("plain"), '"plain"');
});

test("the export lists one row per idea with readable event names and deep links", () => {
  const csv = ideasCsv([idea], "https://prepoc-ten.vercel.app", labels, names);
  const [header, row, trailing] = csv.replace(/^﻿/, "").split("\r\n");
  assert.equal(header, '"Title","Author","Status","Target date","Likes","Published on","Last edited","Link","Problem","Audience","Solution","Approach","Impact"');
  assert.equal(row, '"Time ""booking""","Alex Example","In progress","2027-01-15","3","2026-11-09","2026-11-10","https://prepoc-ten.vercel.app/ideas/0b6f7a1e-5b4e-4d4c-9b5e-1a2b3c4d5e6f","\'=HYPERLINK(""https://evil.example"")","line one\nline two","\'-5 minutes","","\'@sum"');
  assert.equal(trailing, "");
  assert.ok(csv.startsWith("﻿"));
  assert.equal(ideasCsv([], "https://x.example", labels, names).split("\r\n").length, 2);
  // Records from before publishedAt existed fall back to the creation date and show no edit.
  const legacy = { ...idea, publishedAt: undefined, updatedAt: "2026-11-08T09:00:00.000Z" };
  assert.match(ideasCsv([legacy], "https://x.example", labels, names).split("\r\n")[1], /"2026-11-08","",/);
});
