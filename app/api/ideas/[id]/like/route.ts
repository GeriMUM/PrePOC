import { api, body } from "../../../../../lib/api";
import { AppError } from "../../../../../lib/errors";
import { Ideas } from "../../../../../lib/ideas";
import { idSchema } from "../../../../../lib/model";
import { session } from "../../../../../lib/session";
import { storage } from "../../../../../lib/storage";

export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const user = await session();
    const { id } = await context.params;
    if (!idSchema.safeParse(id).success) throw new AppError("NOT_FOUND", 404);
    return new Ideas(storage()).like(id, await body(request), user);
  });
}
