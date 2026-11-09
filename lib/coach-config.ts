import { geminiApiKey } from "./gemini-config";

export type CoachProvider = "copilot" | "gemini";
type Env = Record<string, string | undefined>;

export const directLineSecret = (env: Env = process.env) => env.COPILOT_DIRECT_LINE_SECRET?.trim() || undefined;

/**
 * Which service answers the coach chat. COACH_PROVIDER picks explicitly; without it a configured
 * Copilot Studio agent wins over Gemini. Returns null when the chosen provider lacks its credential.
 */
export function coachProvider(env: Env = process.env): CoachProvider | null {
  const chosen = env.COACH_PROVIDER?.trim().toLowerCase();
  if (chosen === "copilot") return directLineSecret(env) ? "copilot" : null;
  if (chosen === "gemini") return geminiApiKey() ? "gemini" : null;
  if (directLineSecret(env)) return "copilot";
  return geminiApiKey() ? "gemini" : null;
}

export const coachName = (provider: CoachProvider | null) => provider === "copilot" ? "Copilot" : provider === "gemini" ? "Gemini" : "Coach";
