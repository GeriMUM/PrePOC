import assert from "node:assert/strict";
import { test } from "node:test";
import { clean, text, truncate } from "../lib/text";

test("cleaning removes what is invisible or flips text, normalizes, and trims", () => {
  assert.equal(clean("​ ‮Alex‍ Example⁦﻿ "), "Alex Example");
  assert.equal(clean("Å"), "Å");
  assert.equal(clean("á́́́"), "á́");
  assert.equal(clean("line\r\nnext\rlast"), "line\nnext\nlast");
  assert.equal(clean("​⁠­"), "");
  assert.equal(clean("tab\tkept and ümlauts 😀"), "tab\tkept and ümlauts 😀");
});

test("truncation respects the schema length but never splits an emoji", () => {
  assert.equal(truncate("abc", 2), "ab");
  assert.equal(truncate(`${"A".repeat(79)}😀`, 80), "A".repeat(79));
  assert.equal(truncate("😀".repeat(45), 80).length, 80);
});

test("text fields apply limits after cleaning", () => {
  const field = text(5, 1);
  assert.equal(field.parse("  hi​  "), "hi");
  assert.equal(field.safeParse("​").success, false);
  assert.equal(field.safeParse("123456").success, false);
  assert.equal(field.safeParse("  12345  ").success, true);
});
