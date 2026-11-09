import { AppError } from "./errors";
import type { JsonStore } from "./storage";
import { digest } from "./tokens";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
export const day = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

/** Per-account daily limits. The in-memory coach cooldown is only a UX guard; these hold across instances. */
export const limits = {
  /** Saves, comments and likes together. */
  writesPerDay: 300,
  /** Coach messages per account. */
  chatPerDay: 80,
  /** Coach messages for the whole company, so one busy day cannot run up the Gemini bill. */
  chatTotalPerDay: 1500,
} as const;

/** Durable daily counters in the shared store, so limits survive restarts and apply across server instances. */
export class Quota {
  constructor(private store: JsonStore) {}

  /** Counts one use of `subject` in `bucket`; throws `code` with HTTP 429 once `limit` is reached. */
  async consume(bucket: string, subject: string, limit: number, code = "RATE_LIMITED", now = Date.now()): Promise<void> {
    // The subject (an account id or a login state) is hashed, so the store never holds it in clear text.
    const key = `usage/${day(now)}/${bucket}/${digest("quota", subject)}.json`;
    for (let attempt = 0; attempt < 6; attempt++) {
      const file = await this.store.read(key);
      const count = file ? Number((JSON.parse(file.text) as { count?: unknown }).count) || 0 : 0;
      if (count >= limit) throw new AppError(code, 429);
      try {
        await this.store.write(key, JSON.stringify({ count: count + 1 }), file?.version);
        return;
      } catch (error) {
        if (!(error instanceof AppError && error.code === "CONFLICT")) throw error;
        await sleep(10 + Math.random() * 40 * (attempt + 1));
      }
    }
    throw new AppError(code, 429);
  }

  /** One save, comment or like. */
  write(userId: string) {
    return this.consume("writes", userId, limits.writesPerDay);
  }

  /** One coach message, counted for the account and for everyone. */
  async chat(userId: string) {
    await this.consume("chat", userId, limits.chatPerDay, "COACH_BUDGET");
    await this.consume("chat-total", "all", limits.chatTotalPerDay, "COACH_BUDGET");
  }
}
