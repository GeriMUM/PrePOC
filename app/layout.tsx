import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import { cookies } from "next/headers";
import { Platform } from "../components/platform";
import "./globals.css";

const font = Figtree({ subsets: ["latin"], display: "swap", variable: "--font" });

export const metadata: Metadata = {
  title: "copilot & coffee — mann&mouse",
  description: "Turn everyday challenges into thoughtful AI hackathon ideas.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language = (await cookies()).get("spark-language")?.value === "de" ? "de" : "en";
  return <html lang={language} className={font.variable}><body><Platform initialLanguage={language}>{children}</Platform></body></html>;
}
