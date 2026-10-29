import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Platform } from "../components/platform";
import "./globals.css";

export const metadata: Metadata = {
  title: "copilot & coffee — The idea lab",
  description: "Turn everyday challenges into thoughtful AI hackathon ideas.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language = (await cookies()).get("spark-language")?.value === "de" ? "de" : "en";
  return <html lang={language}><body><Platform initialLanguage={language}>{children}</Platform></body></html>;
}
