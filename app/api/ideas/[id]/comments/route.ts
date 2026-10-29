import { api, body } from "../../../../../lib/api";
import { AppError } from "../../../../../lib/errors";
import { Ideas } from "../../../../../lib/ideas";
import { idSchema } from "../../../../../lib/model";
import { session } from "../../../../../lib/session";
import { storage } from "../../../../../lib/storage";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
async function ideaId(context: Context) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) throw new AppError("NOT_FOUND", 404);
  return id;
}
export async function GET(_request: Request, context: Context) {
  return api(async () => new Ideas(storage()).comments(await ideaId(context)));
}
export async function POST(request: Request, context: Context) {
  return api(async () => {
    await session();
    return new Ideas(storage()).comment(await ideaId(context), await body(request));
  });
}
