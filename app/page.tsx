import { Workshop } from "../components/workshop";
import { geminiApiKey } from "../lib/gemini-config";
export default function Home() {
  return <Workshop coachConfigured={Boolean(geminiApiKey())} />;
}
