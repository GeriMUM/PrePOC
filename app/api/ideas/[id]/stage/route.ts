import { api, body } from "../../../../../lib/api";
import { AppError } from "../../../../../lib/errors";
import { Ideas } from "../../../../../lib/ideas";
import { idSchema } from "../../../../../lib/model";
import { Quota } from "../../../../../lib/quota";
import { session } from "../../../../../lib/session";
import { storage } from "../../../../../lib/storage";

export const dynamic = "force-dynamic";
// The owner sets the idea's progress: new, in progress or closed.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const user = await session();
    const { id } = await context.params;
    if (!idSchema.safeParse(id).success) throw new AppError("NOT_FOUND", 404);
    const store = storage();
    await new Quota(store).write(user.id);
    return new Ideas(store).setStage(id, await body(request), user);
  });
}
