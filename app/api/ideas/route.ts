import { api, body } from "../../../lib/api";
import { Ideas } from "../../../lib/ideas";
import { session } from "../../../lib/session";
import { storage } from "../../../lib/storage";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  return api(async () => {
    const mine = new URL(request.url).searchParams.get("mine") === "1";
    const user = await session();
    return new Ideas(storage()).all(mine ? user.id : undefined);
  });
}
export async function POST(request: Request) {
  return api(async () => {
    const owner = await session();
    return new Ideas(storage()).save(await body(request), owner);
  });
}
