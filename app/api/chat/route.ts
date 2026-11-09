import { api, body } from "../../../lib/api";
import { coachProvider, directLineSecret } from "../../../lib/coach-config";
import { copilotReply } from "../../../lib/copilot";
import { chatInputSchema, geminiReply, releaseCoachRequest, reserveCoachRequest } from "../../../lib/gemini";
import { AppError } from "../../../lib/errors";
import { Quota } from "../../../lib/quota";
import { session } from "../../../lib/session";
import { storage } from "../../../lib/storage";

export const runtime = "nodejs";
// Long enough that nobody notices; replyBudget ends just before it.
export const maxDuration = 300;

export async function POST(request: Request) {
  return api(async () => {
    // Authenticate before touching the body, so anonymous requests cost nothing.
    // The coach's time budget starts now, so slow storage cannot push the reply past maxDuration.
    const deadline = Date.now() + 290_000;
    const owner = await session();
    reserveCoachRequest(owner.id);
    try {
      const input = chatInputSchema.safeParse(await body(request, 96_000));
      if (!input.success) throw new AppError("INVALID_INPUT");
      const provider = coachProvider();
      if (!provider) throw new AppError("COACH_NOT_CONFIGURED", 503);
      await new Quota(storage()).chat(owner.id);
      if (provider === "copilot") return await copilotReply(input.data, directLineSecret() ?? "", owner.id, { deadline });
      return await geminiReply(input.data);
    } catch (error) {
      releaseCoachRequest(owner.id);
      throw error;
    }
  });
}
