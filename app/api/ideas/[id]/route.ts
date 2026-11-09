import { api, sameOrigin } from "../../../../lib/api";
import { AppError } from "../../../../lib/errors";
import { Ideas } from "../../../../lib/ideas";
import { idSchema } from "../../../../lib/model";
import { Quota } from "../../../../lib/quota";
import { session } from "../../../../lib/session";
import { storage } from "../../../../lib/storage";

export const dynamic = "force-dynamic";
// Removing an idea with a long conversation takes several storage calls.
export const maxDuration = 60;

/** Deletes one of the signed-in user's own ideas (draft or published, including its comments). */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return api(async () => {
    const user = await session();
    sameOrigin(request);
    const { id } = await context.params;
    if (!idSchema.safeParse(id).success) throw new AppError("NOT_FOUND", 404);
    const store = storage();
    await new Quota(store).write(user.id);
    await new Ideas(store).deleteIdea(id, user);
    return { deleted: id };
  });
}
