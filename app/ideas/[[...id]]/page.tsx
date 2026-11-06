import { notFound } from "next/navigation";
import { Gallery } from "../../../components/gallery";
import { idSchema } from "../../../lib/model";
import { requireUser } from "../../../lib/session";

// Serves both /ideas and /ideas/<id>, so opening or closing an idea never remounts the gallery.
export default async function IdeasPage({ params }: { params: Promise<{ id?: string[] }> }) {
  const { id = [] } = await params;
  if (id.length > 1 || (id[0] && !idSchema.safeParse(id[0]).success)) notFound();
  await requireUser(id[0] ? `/ideas/${id[0]}` : "/ideas");
  return <Gallery initialId={id[0] ?? ""} />;
}
