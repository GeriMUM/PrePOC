import { api } from "../../../lib/api";
import { session } from "../../../lib/session";

export const dynamic = "force-dynamic";
export async function GET() {
  return api(async () => { await session(true); return { ready: true }; });
}
