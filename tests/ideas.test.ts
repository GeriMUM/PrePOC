import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AppError } from "../lib/errors";
import { Ideas } from "../lib/ideas";
import { emptyIdea, type SaveIdea } from "../lib/model";
import { FileStore } from "../lib/storage";

const owner = { id: randomUUID(), name: "Alex Example" };
const other = { id: randomUUID(), name: "Sam Other" };
const input: SaveIdea = {
  title: "Time booking assistant", eventId: "coffee-1",
  problem: "Booking hours takes too long.", audience: "Employees",
  solution: "Suggest entries from a short conversation.",
  approach: "Description → suggestion → human approval → booking tool",
  impact: "Test with five people and measure time saved.", publish: false,
};
const { author: _author, ...blank } = emptyIdea();
void _author;
const hasCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;

async function setup() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coffee-test-"));
  const store = new FileStore(directory);
  return { directory, store, ideas: new Ideas(store), cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("drafts persist across service instances and stay out of public and other users' views", async () => {
  const { directory, ideas, cleanup } = await setup();
  try {
    const saved = await ideas.save(input, owner);
    assert.equal(saved.status, "draft");
    assert.equal("ownerId" in saved, false);
    assert.deepEqual(await ideas.all(), []);
    assert.deepEqual(await ideas.all(other.id), []);
    const reopened = await new Ideas(new FileStore(directory)).all(owner.id);
    assert.equal(reopened[0].id, saved.id);
    assert.equal(reopened[0].problem, input.problem);
    assert.equal(reopened[0].version, saved.version);
    await assert.rejects(ideas.save({ ...input, id: saved.id, version: saved.version }, other), hasCode("NOT_FOUND"));
  } finally { await cleanup(); }
});

test("the author is always the signed-in user and cannot be supplied by the client", async () => {
  const { ideas, cleanup } = await setup();
  try {
    assert.equal((await ideas.save(input, owner)).author, owner.name);
    await assert.rejects(ideas.save({ ...input, author: "Impersonated" }, owner), hasCode("INVALID_INPUT"));
    await assert.rejects(ideas.save({ ...input, ownerId: other.id }, owner), hasCode("INVALID_INPUT"));
  } finally { await cleanup(); }
});

test("drafts can be incomplete; publishing only requires title and problem", async () => {
  const { ideas, cleanup } = await setup();
  try {
    assert.equal((await ideas.save({ ...blank, publish: false }, owner)).status, "draft");
    for (const field of ["title", "problem"] as const) {
      await assert.rejects(ideas.save({ ...input, [field]: " ", publish: true }, owner), hasCode("INCOMPLETE_IDEA"));
    }
    const simple = await ideas.save({ ...blank, title: "Time booking", problem: "Booking hours is slow", publish: true }, owner);
    assert.equal(simple.status, "published");
    assert.equal(simple.author, owner.name);
    assert.equal(simple.approach, "");
    assert.equal(simple.solution, "");
    await assert.rejects(ideas.save({ ...input, title: "x".repeat(121) }, owner), hasCode("INVALID_INPUT"));
    await assert.rejects(ideas.save({ ...input, problem: "x".repeat(3001) }, owner), hasCode("INVALID_INPUT"));
    await assert.rejects(ideas.save({ ...input, eventId: "unknown" }, owner), hasCode("INVALID_INPUT"));
  } finally { await cleanup(); }
});

test("publishing updates the same idea, exposes it publicly, and freezes further edits", async () => {
  const { ideas, cleanup } = await setup();
  try {
    const draft = await ideas.save(input, owner);
    const published = await ideas.save({ ...input, id: draft.id, version: draft.version, publish: true }, owner);
    assert.equal(published.id, draft.id);
    assert.equal(published.status, "published");
    assert.equal(published.createdAt, draft.createdAt);
    assert.equal((await ideas.all()).length, 1);
    assert.equal((await ideas.all())[0].id, draft.id);
    await assert.rejects(ideas.save({ ...input, id: draft.id, version: published.version }, owner), hasCode("ALREADY_PUBLISHED"));
  } finally { await cleanup(); }
});

test("concurrent edits accept one winner and report a conflict without corrupting data", async () => {
  const { store, ideas, cleanup } = await setup();
  try {
    const draft = await ideas.save(input, owner);
    const results = await Promise.allSettled(["First update", "Second update"].map((title) =>
      ideas.save({ ...input, title, id: draft.id, version: draft.version }, owner)));
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected");
    assert.ok(rejected?.status === "rejected" && hasCode("CONFLICT")(rejected.reason));
    const file = await store.read(`ideas/${draft.id}.json`);
    assert.ok(file);
    assert.ok(["First update", "Second update"].includes(JSON.parse(file.text).title));
    await assert.rejects(ideas.save({ ...input, id: draft.id, version: draft.version }, owner), hasCode("CONFLICT"));
  } finally { await cleanup(); }
});

test("comments are separate immutable files, carry the signed-in author, and are all retained", async () => {
  const { store, ideas, cleanup } = await setup();
  try {
    const draft = await ideas.save(input, owner);
    await assert.rejects(ideas.comments(draft.id), hasCode("NOT_FOUND"));
    await assert.rejects(ideas.comment(draft.id, { text: "Hello" }, other), hasCode("NOT_FOUND"));
    const published = await ideas.save({ ...input, publish: true }, owner);
    const posted = await Promise.all(Array.from({ length: 10 }, (_, index) =>
      ideas.comment(published.id, { text: `Question ${index}` }, other)));
    const comments = await ideas.comments(published.id);
    assert.equal(comments.length, 10);
    assert.equal(new Set(comments.map((comment) => comment.id)).size, 10);
    assert.deepEqual(new Set(comments.map((comment) => comment.id)), new Set(posted.map((comment) => comment.id)));
    assert.ok(comments.every((comment) => comment.author === other.name && !("authorId" in comment)));
    const stored = await store.read(`comments/${published.id}/${posted[0].id}.json`);
    assert.equal(JSON.parse(stored?.text ?? "{}").authorId, other.id);
    assert.equal((await ideas.all())[0].version, published.version);
    await assert.rejects(ideas.comment(published.id, { author: "Impersonated", text: "Hi" }, other), hasCode("INVALID_INPUT"));
    await assert.rejects(ideas.comment(published.id, { text: " " }, other), hasCode("INVALID_INPUT"));
    await assert.rejects(ideas.comment(published.id, { text: "x".repeat(1501) }, other), hasCode("INVALID_INPUT"));
  } finally { await cleanup(); }
});

test("storage rejects path traversal and create collisions", async () => {
  const { store, cleanup } = await setup();
  try {
    await assert.rejects(store.read("ideas/../../secret.json"), /Invalid storage key/);
    assert.deepEqual(await store.keys("ideas/"), []);
    const key = `ideas/${randomUUID()}.json`;
    await store.write(key, '{"ok":true}');
    await assert.rejects(store.write(key, '{"ok":false}'), hasCode("CONFLICT"));
    assert.deepEqual(await store.keys("ideas/"), [key]);
  } finally { await cleanup(); }
});
