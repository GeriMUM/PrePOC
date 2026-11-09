import { api, body } from "../../../../../lib/api";
import { AppError } from "../../../../../lib/errors";
import { Ideas } from "../../../../../lib/ideas";
import { idSchema } from "../../../../../lib/model";
import { Quota } from "../../../../../lib/quota";
import { session } from "../../../../../lib/session";
import { storage } from "../../../../../lib/storage";

export const dynamic = "force-dynamic";

async function ideaId(context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw new AppError("NOT_FOUND", 404);
  return id;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const user = await session();
    return new Ideas(storage()).comments(await ideaId(context), user.id);
  });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const user = await session();
    const id = await ideaId(context);
    const store = storage();
    await new Quota(store).write(user.id);
    return new Ideas(store).comment(id, await body(request), user);
  });
}
