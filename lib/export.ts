import { events, type Idea } from "./model";

export type ExportLabels = Record<
  "title" | "author" | "event" | "likes" | "publishedOn" | "link" | "problem" | "audience" | "solution" | "approach" | "impact", string>;

/** One CSV cell: quoted, with quotes doubled, and spreadsheet formula triggers neutralised. */
export function csvCell(value: string | number): string {
  let text = String(value);
  // A cell starting with = + - @ or a tab/CR would be executed as a formula by Excel and friends.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

/** The published ideas as a UTF-8 CSV (with BOM for Excel), one row per idea, newest first as listed. */
export function ideasCsv(ideas: Idea[], origin: string, labels: ExportLabels): string {
  const header = [labels.title, labels.author, labels.event, labels.likes, labels.publishedOn, labels.link,
    labels.problem, labels.audience, labels.solution, labels.approach, labels.impact];
  const rows = ideas.map((idea) => [
    idea.title, idea.author, events.find((event) => event.id === idea.eventId)?.name ?? idea.eventId, idea.likes,
    idea.createdAt.slice(0, 10), `${origin}/ideas/${idea.id}`,
    idea.problem, idea.audience, idea.solution, idea.approach, idea.impact,
  ]);
  return `﻿${[header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
