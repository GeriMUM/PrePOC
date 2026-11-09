import { api, body } from "../../../lib/api";
import { chatInputSchema, releaseCoachRequest, reserveCoachRequest } from "../../../lib/chat";
import { directLineSecret } from "../../../lib/coach-config";
import { copilotReply } from "../../../lib/copilot";
import { AppError } from "../../../lib/errors";
import { Quota } from "../../../lib/quota";
import { session } from "../../../lib/session";
import { storage } from "../../../lib/storage";

export const runtime = "nodejs";
// Long enough that nobody notices; replyBudget ends just before it.
export const maxDuration = 300;

export async function POST(request: Request) {
  return api(async () => {
    // The coach's time budget starts now, so slow storage cannot push the reply past maxDuration.
    const deadline = Date.now() + 290_000;
    // Authenticate before touching the body, so anonymous requests cost nothing.
    const owner = await session();
    reserveCoachRequest(owner.id);
    try {
      const input = chatInputSchema.safeParse(await body(request, 96_000));
      if (!input.success) throw new AppError("INVALID_INPUT");
      const secret = directLineSecret();
      if (!secret) throw new AppError("COACH_NOT_CONFIGURED", 503);
      await new Quota(storage()).chat(owner.id);
      return await copilotReply(input.data, secret, owner.id, { deadline });
    } catch (error) {
      releaseCoachRequest(owner.id);
      throw error;
    }
  });
}
