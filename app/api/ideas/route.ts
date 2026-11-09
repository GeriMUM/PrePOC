import { api, body } from "../../../lib/api";
import { Ideas } from "../../../lib/ideas";
import { Quota } from "../../../lib/quota";
import { session } from "../../../lib/session";
import { storage } from "../../../lib/storage";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return api(async () => {
    const user = await session();
    const mine = new URL(request.url).searchParams.get("mine") === "1";
    return new Ideas(storage()).all(mine ? user.id : undefined, user.id);
  });
}

export async function POST(request: Request) {
  return api(async () => {
    const user = await session();
    const store = storage();
    await new Quota(store).write(user.id);
    return new Ideas(store).save(await body(request), user);
  });
}
