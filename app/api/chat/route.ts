import { api, body } from "../../../lib/api";
import { coachProvider, directLineSecret } from "../../../lib/coach-config";
import { copilotReply } from "../../../lib/copilot";
import { chatInputSchema, geminiReply, reserveCoachRequest } from "../../../lib/gemini";
import { AppError } from "../../../lib/errors";
import { Quota } from "../../../lib/quota";
import { session } from "../../../lib/session";
import { storage } from "../../../lib/storage";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return api(async () => {
    // Authenticate before touching the body, so anonymous requests cost nothing.
    const owner = await session();
    reserveCoachRequest(owner.id);
    const input = chatInputSchema.safeParse(await body(request, 96_000));
    if (!input.success) throw new AppError("INVALID_INPUT");
    const provider = coachProvider();
    if (!provider) throw new AppError("COACH_NOT_CONFIGURED", 503);
    await new Quota(storage()).chat(owner.id);
    if (provider === "copilot") return copilotReply(input.data, directLineSecret() ?? "", owner.id);
    return geminiReply(input.data);
  });
}
