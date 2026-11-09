import { Workshop } from "../components/workshop";
import { geminiApiKey } from "../lib/gemini-config";
import { idSchema } from "../lib/model";
import { requireUser } from "../lib/session";

export default async function Home({ searchParams }: { searchParams: Promise<{ idea?: string | string[] }> }) {
  // /?idea=<id> opens one of the user's own ideas for editing (the gallery links here).
  const { idea } = await searchParams;
  const initialId = typeof idea === "string" && idSchema.safeParse(idea).success ? idea : "";
  const user = await requireUser(initialId ? `/?idea=${initialId}` : "/");
  return <Workshop coachConfigured={Boolean(geminiApiKey())} userName={user.name} initialId={initialId} />;
}
