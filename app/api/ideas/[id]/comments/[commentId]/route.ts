import { api, sameOrigin } from "../../../../../../lib/api";
import { AppError } from "../../../../../../lib/errors";
import { Ideas } from "../../../../../../lib/ideas";
import { idSchema } from "../../../../../../lib/model";
import { Quota } from "../../../../../../lib/quota";
import { session } from "../../../../../../lib/session";
import { storage } from "../../../../../../lib/storage";

export const dynamic = "force-dynamic";

/** Deletes one of the signed-in user's own comments. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string; commentId: string }> }) {
  return api(async () => {
    const user = await session();
    sameOrigin(request);
    const { id, commentId } = await context.params;
    if (!idSchema.safeParse(id).success || !idSchema.safeParse(commentId).success) throw new AppError("NOT_FOUND", 404);
    const store = storage();
    await new Quota(store).write(user.id);
    await new Ideas(store).deleteComment(id, commentId, user);
    return { deleted: commentId };
  });
}
