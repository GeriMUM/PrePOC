import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { AppError } from "../lib/errors";
import { defaultLimits, Ideas } from "../lib/ideas";
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

async function setup(limits = defaultLimits) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "coffee-test-"));
  const store = new FileStore(directory);
  return { directory, store, ideas: new Ideas(store, limits), cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test("drafts persist across service instances and stay out of public and other users' views", async () => {
  const { directory, ideas, cleanup } = await setup();
  try {
    const saved = await ideas.save(input, owner);
    assert.equal(saved.status, "draft");
    assert.equal("ownerId" in saved, false);
    assert.ok(saved.version);
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

test("invisible characters do not count as content and direction overrides are removed", async () => {
  const { ideas, cleanup } = await setup();
  try {
    await assert.rejects(ideas.save({ ...input, title: "​​ ﻿", publish: true }, owner), hasCode("INCOMPLETE_IDEA"));
    const saved = await ideas.save({ ...input, title: "Re‮port​ for Å", problem: "á́́́ line\r\nnext" }, owner);
    assert.equal(saved.title, "Report for Å");
    assert.equal(saved.problem, "á́ line\nnext");
    const published = await ideas.save({ ...input, publish: true }, owner);
    await assert.rejects(ideas.comment(published.id, { text: "​⁠" }, other), hasCode("INVALID_INPUT"));
  } finally { await cleanup(); }
});

test("publishing updates the same idea, exposes it publicly without a storage version, and freezes further edits", async () => {
  const { ideas, cleanup } = await setup();
  try {
    const draft = await ideas.save(input, owner);
    const published = await ideas.save({ ...input, id: draft.id, version: draft.version, publish: true }, owner);
    assert.equal(published.id, draft.id);
    assert.equal(published.status, "published");
    assert.equal(published.createdAt, draft.createdAt);
    assert.equal(published.version, undefined);
    assert.equal((await ideas.all()).length, 1);
    assert.equal((await ideas.all())[0].id, draft.id);
    assert.equal("version" in (await ideas.all(undefined, other.id))[0], false);
    assert.equal("version" in (await ideas.all(owner.id))[0], false);
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

test("each account has a bounded number of drafts and published ideas, and the store a total", async () => {
  const { ideas, cleanup } = await setup({ ...defaultLimits, drafts: 2, published: 1, total: 4 });
  try {
    const first = await ideas.save(input, owner);
    await ideas.save(input, owner);
    await assert.rejects(ideas.save(input, owner), hasCode("IDEA_LIMIT"));
    await ideas.save({ ...input, id: first.id, version: first.version, publish: true }, owner);
    await assert.rejects(ideas.save({ ...input, publish: true }, owner), hasCode("IDEA_LIMIT"));
    await ideas.save(input, owner);
    await ideas.save(input, other);
    await assert.rejects(ideas.save(input, other), hasCode("IDEA_LIMIT"));
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
    await assert.rejects(ideas.comment(published.id, { author: "Impersonated", text: "Hi" }, other), hasCode("INVALID_INPUT"));
    await assert.rejects(ideas.comment(published.id, { text: " " }, other), hasCode("INVALID_INPUT"));
    await assert.rejects(ideas.comment(published.id, { text: "x".repeat(1501) }, other), hasCode("INVALID_INPUT"));
  } finally { await cleanup(); }
});

test("comment volume is bounded per account and per idea, and repeats are refused", async () => {
  const { ideas, cleanup } = await setup({ ...defaultLimits, comments: 3, commentsPerAuthor: 2 });
  try {
    const published = await ideas.save({ ...input, publish: true }, owner);
    await ideas.comment(published.id, { text: "First" }, other);
    await assert.rejects(ideas.comment(published.id, { text: "First" }, other), hasCode("COMMENT_DUPLICATE"));
    await ideas.comment(published.id, { text: "Second" }, other);
    await assert.rejects(ideas.comment(published.id, { text: "Third" }, other), hasCode("COMMENT_LIMIT"));
    const third = { id: randomUUID(), name: "Third Person" };
    await ideas.comment(published.id, { text: "Hello" }, third);
    await assert.rejects(ideas.comment(published.id, { text: "Too many" }, { id: randomUUID(), name: "Fourth" }), hasCode("COMMENT_LIMIT"));
    assert.equal((await ideas.comments(published.id)).length, 3);
  } finally { await cleanup(); }
});

test("likes are anonymous, one per signed-in user, only on published ideas, never by the owner", async () => {
  const { store, ideas, cleanup } = await setup();
  try {
    const draft = await ideas.save(input, owner);
    await assert.rejects(ideas.like(draft.id, { like: true }, other), hasCode("NOT_FOUND"));
    const published = await ideas.save({ ...input, publish: true }, owner);
    assert.deepEqual([published.likes, published.liked, published.mine], [0, false, true]);
    await assert.rejects(ideas.like(published.id, { like: true }, owner), hasCode("OWN_IDEA"));
    await assert.rejects(ideas.like(published.id, { like: true, name: "Boss" }, other), hasCode("INVALID_INPUT"));

    const liked = await ideas.like(published.id, { like: true }, other);
    assert.deepEqual([liked.likes, liked.liked, liked.mine], [1, true, false]);
    assert.equal((await ideas.like(published.id, { like: true }, other)).likes, 1);
    // Browsers get only a number: no names, account ids or storage versions of published ideas.
    assert.ok(!JSON.stringify(liked).includes(other.id) && !JSON.stringify(liked).includes(other.name));
    assert.equal(liked.version, undefined);
    // The store holds a keyed hash, not the account id.
    const stored = JSON.parse((await store.read(`ideas/${published.id}.json`))?.text ?? "{}");
    assert.equal(stored.likes.length, 1);
    assert.ok(!JSON.stringify(stored).includes(other.id));
    assert.equal(stored.updatedAt, published.updatedAt);

    const viewers = Array.from({ length: 4 }, (_, index) => ({ id: randomUUID(), name: `Colleague ${index}` }));
    await Promise.all(viewers.map((viewer) => ideas.like(published.id, { like: true }, viewer)));
    const [listed] = await ideas.all(undefined, other.id);
    assert.equal(listed.likes, 5);
    assert.equal(listed.liked, true);
    assert.equal((await ideas.all(undefined, owner.id))[0].liked, false);
    assert.equal("ownerId" in listed, false);

    const unliked = await ideas.like(published.id, { like: false }, other);
    assert.deepEqual([unliked.likes, unliked.liked], [4, false]);
  } finally { await cleanup(); }
});

test("public listings are identical whoever liked, so nothing in them can identify a liker", async () => {
  const { ideas, cleanup } = await setup();
  try {
    const published = await ideas.save({ ...input, publish: true }, owner);
    const viewer = { id: randomUUID(), name: "Viewer" };
    await ideas.like(published.id, { like: true }, other);
    const likedByOther = JSON.stringify(await ideas.all(undefined, viewer.id));
    await ideas.like(published.id, { like: false }, other);
    await ideas.like(published.id, { like: true }, { id: randomUUID(), name: "Someone Else" });
    assert.equal(JSON.stringify(await ideas.all(undefined, viewer.id)), likedByOther);
    assert.ok(!likedByOther.includes(other.id));
  } finally { await cleanup(); }
});

test("likes recorded as raw account ids before hashing still count and can be withdrawn", async () => {
  const { store, ideas, cleanup } = await setup();
  try {
    const published = await ideas.save({ ...input, publish: true }, owner);
    const file = await store.read(`ideas/${published.id}.json`);
    await store.write(`ideas/${published.id}.json`, JSON.stringify({ ...JSON.parse(file?.text ?? "{}"), likes: [other.id] }), file?.version);
    const [listed] = await ideas.all(undefined, other.id);
    assert.deepEqual([listed.likes, listed.liked], [1, true]);
    assert.equal((await ideas.like(published.id, { like: true }, other)).likes, 1);
    assert.deepEqual((await ideas.like(published.id, { like: false }, other)).likes, 0);
  } finally { await cleanup(); }
});

test("the like cap is enforced before writing, so a record can never become unreadable", async () => {
  const { ideas, cleanup } = await setup({ ...defaultLimits, likes: 1 });
  try {
    const published = await ideas.save({ ...input, publish: true }, owner);
    await ideas.like(published.id, { like: true }, other);
    await assert.rejects(ideas.like(published.id, { like: true }, { id: randomUUID(), name: "Late" }), hasCode("LIKE_LIMIT"));
    assert.equal((await ideas.all())[0].likes, 1);
  } finally { await cleanup(); }
});

test("one damaged record is skipped instead of taking down the gallery or a conversation", async () => {
  const { store, ideas, cleanup } = await setup();
  try {
    const published = await ideas.save({ ...input, publish: true }, owner);
    await store.write(`ideas/${randomUUID()}.json`, "{not json");
    await store.write(`ideas/${randomUUID()}.json`, JSON.stringify({ id: "broken" }));
    const listed = await ideas.all();
    assert.deepEqual(listed.map((idea) => idea.id), [published.id]);
    await ideas.comment(published.id, { text: "Fine" }, other);
    await store.write(`comments/${published.id}/${randomUUID()}.json`, "[]");
    assert.equal((await ideas.comments(published.id)).length, 1);
  } finally { await cleanup(); }
});

test("owners can delete their own drafts, but nobody can delete published ideas or others' drafts", async () => {
  const { store, ideas, cleanup } = await setup();
  try {
    const draft = await ideas.save(input, owner);
    const published = await ideas.save({ ...input, publish: true }, owner);
    await assert.rejects(ideas.deleteDraft(draft.id, other), hasCode("NOT_FOUND"));
    await assert.rejects(ideas.deleteDraft(published.id, owner), hasCode("ALREADY_PUBLISHED"));
    await assert.rejects(ideas.deleteDraft(randomUUID(), owner), hasCode("NOT_FOUND"));
    await ideas.deleteDraft(draft.id, owner);
    assert.deepEqual(await ideas.all(owner.id).then((mine) => mine.map((idea) => idea.id)), [published.id]);
    assert.equal(await store.read(`ideas/${draft.id}.json`), null);
    await assert.rejects(ideas.deleteDraft(draft.id, owner), hasCode("NOT_FOUND"));
    await store.delete(`ideas/${draft.id}.json`);
  } finally { await cleanup(); }
});

test("authors can delete their own comments and see which ones are theirs", async () => {
  const { store, ideas, cleanup } = await setup();
  try {
    const published = await ideas.save({ ...input, publish: true }, owner);
    const mine = await ideas.comment(published.id, { text: "Mine" }, other);
    const theirs = await ideas.comment(published.id, { text: "Theirs" }, owner);
    assert.equal(mine.mine, true);
    assert.deepEqual((await ideas.comments(published.id, other.id)).map((comment) => [comment.text, comment.mine]), [["Mine", true], ["Theirs", false]]);
    assert.ok((await ideas.comments(published.id)).every((comment) => !comment.mine));
    await assert.rejects(ideas.deleteComment(published.id, theirs.id, other), hasCode("NOT_FOUND"));
    await assert.rejects(ideas.deleteComment(randomUUID(), mine.id, other), hasCode("NOT_FOUND"));
    await ideas.deleteComment(published.id, mine.id, other);
    assert.deepEqual((await ideas.comments(published.id)).map((comment) => comment.text), ["Theirs"]);
    assert.equal(await store.read(`comments/${published.id}/${mine.id}.json`), null);
  } finally { await cleanup(); }
});

test("storage rejects path traversal and create collisions", async () => {
  const { store, cleanup } = await setup();
  try {
    await assert.rejects(store.read("ideas/../../secret.json"), /Invalid storage key/);
    await assert.rejects(store.read("secrets/x.json"), /Invalid storage key/);
    assert.deepEqual(await store.keys("ideas/"), []);
    const key = `ideas/${randomUUID()}.json`;
    await store.write(key, '{"ok":true}');
    await assert.rejects(store.write(key, '{"ok":false}'), hasCode("CONFLICT"));
    assert.deepEqual(await store.keys("ideas/"), [key]);
  } finally { await cleanup(); }
});
