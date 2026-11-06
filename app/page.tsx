import { Workshop } from "../components/workshop";
import { geminiApiKey } from "../lib/gemini-config";
import { requireUser } from "../lib/session";

export default async function Home() {
  const user = await requireUser("/");
  return <Workshop coachConfigured={Boolean(geminiApiKey())} userName={user.name} />;
}
