import { Gallery } from "../../components/gallery";
import { requireUser } from "../../lib/session";

export default async function IdeasPage() {
  await requireUser("/ideas");
  return <Gallery />;
}
