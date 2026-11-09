import { z } from "zod";

// Control characters, zero-width and bidirectional formatting characters, soft hyphens and the byte
// order mark: invisible in the UI, but they defeat emptiness checks, flip neighbouring text or break search.
// (Built from code points, because U+2028/U+2029 are line terminators and cannot appear in a regex literal.)
const invisibleRanges: [number, number][] = [
  [0x0000, 0x0008], [0x000b, 0x000c], [0x000e, 0x001f], [0x007f, 0x009f], [0x00ad, 0x00ad], [0x061c, 0x061c],
  [0x180e, 0x180e], [0x200b, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f], [0xfeff, 0xfeff], [0xfff9, 0xfffb],
];
const codePoint = (value: number) => `\\u{${value.toString(16)}}`;
const invisible = new RegExp(`[${invisibleRanges.map(([from, to]) => from === to ? codePoint(from) : `${codePoint(from)}-${codePoint(to)}`).join("")}]`, "gu");
// Stacked combining marks ("zalgo") render far outside the line box; two per base character is plenty.
const stacked = /(\p{M}{2})\p{M}+/gu;

/** Normalizes user text: NFC, no invisible characters, bounded combining marks, Unix newlines, trimmed. */
export function clean(value: string): string {
  return value.replace(stacked, "$1").normalize("NFC").replace(invisible, "").replace(/\r\n?/g, "\n").trim();
}

/** Cuts to at most `max` UTF-16 units (the length schemas measure) without splitting a surrogate pair. */
export function truncate(value: string, max: number): string {
  let result = "";
  for (const character of value) {
    if (result.length + character.length > max) break;
    result += character;
  }
  return result;
}

/** A cleaned text field whose length limits apply after cleaning. */
export const text = (max: number, min = 0) =>
  z.string().max(max * 4 + 64).transform(clean).pipe(z.string().min(min).max(max));
