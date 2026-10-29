import { api, body } from "../../../../lib/api";
import { coachToken } from "../../../../lib/coach-config";
import { session } from "../../../../lib/session";

export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  return api(async () => {
    await body(request);
    await session(true);
    return coachToken();
  });
}
