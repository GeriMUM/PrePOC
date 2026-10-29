import { api, body } from "../../../lib/api";
import { chatInputSchema, geminiReply, reserveCoachRequest } from "../../../lib/gemini";
import { AppError } from "../../../lib/errors";
import { session } from "../../../lib/session";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request) {
  return api(async () => {
    const input = chatInputSchema.safeParse(await body(request, 96_000));
    if (!input.success) throw new AppError("INVALID_INPUT");
    const owner = await session();
    reserveCoachRequest(owner);
    return geminiReply(input.data);
  });
}
