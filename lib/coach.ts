import { ideaFieldsSchema, type IdeaFields, type Language } from "./model";
import { truncate } from "./text";

// The coach may only suggest the two fields the workshop shows and the author can review.
export const summarySchema = ideaFieldsSchema.pick({ title: true, problem: true }).partial().strict();
export type IdeaSummary = Partial<Pick<IdeaFields, "title" | "problem">>;
// Fields the workshop does not show are dropped rather than published unseen.
const hidden = ["audience", "solution", "approach", "impact"];

export function parseCoachReply(text: string): { text: string; summary?: IdeaSummary; invalidSummary?: boolean } {
  // Models sometimes write ```json + idea-summary on the next line instead of ```idea-summary.
  const block = /```[ \t]*(?:json[ \t]*\r?\n?[ \t]*)?idea-summary[ \t]*\r?\n([\s\S]*?)```/i.exec(text);
  if (!block) return { text };
  try {
    const raw: unknown = JSON.parse(block[1]);
    const visible = raw && typeof raw === "object" && !Array.isArray(raw)
      ? Object.fromEntries(Object.entries(raw).filter(([key]) => !hidden.includes(key))) : raw;
    const parsed = summarySchema.safeParse(visible);
    if (!parsed.success || !Object.values(parsed.data).some((value) => value?.trim())) {
      return { text, invalidSummary: true };
    }
    return { text: text.replace(block[0], "").trim(), summary: parsed.data };
  } catch {
    return { text, invalidSummary: true };
  }
}

export type CoachTurn = { role: "user" | "model"; text: string };
export function coachHistory(history: CoachTurn[], message: string): CoachTurn[] {
  let turns: CoachTurn[] = [...history, { role: "user", text: message }];
  while (turns.length > 11 || turns.reduce((length, turn) => length + turn.text.length, 0) > 10_000) {
    turns = turns.slice(2);
  }
  return turns;
}

/** The hidden request the "move to form" button sends; the agent's own instructions stay free of format rules. */
export function summaryRequest(language: Language) {
  return language === "de"
    ? 'Fasse die bisher besprochene Idee für das Ideenformular zusammen. Antworte ausschließlich mit einem JSON-Objekt, ohne weiteren Text und ohne Codeblock: {"title": "kurzer, sprechender Titel (höchstens 100 Zeichen)", "problem": "das Problem und die vereinbarte Lösung in einfachen Worten (höchstens 1500 Zeichen)"}'
    : 'Summarise the idea discussed so far for the idea form. Reply only with a JSON object, no other text and no code block: {"title": "short, telling title (at most 100 characters)", "problem": "the problem and the agreed solution in plain words (at most 1500 characters)"}';
}

/** Reads title and problem from a reply that should be JSON, tolerating code fences or surrounding text. */
export function extractSummary(text: string): IdeaSummary | null {
  const fenced = parseCoachReply(text).summary;
  if (fenced) return fenced;
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const raw: unknown = JSON.parse(text.slice(start, end + 1));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const { title, problem } = raw as Record<string, unknown>;
    const pick = (value: unknown, max: number) => typeof value === "string" ? truncate(value.trim(), max) : undefined;
    const picked = Object.fromEntries(Object.entries({ title: pick(title, 120), problem: pick(problem, 3000) }).filter(([, value]) => value));
    const parsed = summarySchema.safeParse(picked);
    return parsed.success && Object.values(parsed.data).some((value) => value?.trim()) ? parsed.data : null;
  } catch {
    return null;
  }
}
