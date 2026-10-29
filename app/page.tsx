import { Workshop } from "../components/workshop";
export default function Home() {
  return <Workshop coachConfigured={Boolean(process.env.GOOGLE_GENERATIVE_AI_API_KEY?.trim())} />;
}
