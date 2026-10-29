"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { messages, type Messages } from "../lib/i18n";
import type { Language } from "../lib/model";

const Context = createContext<{ language: Language; t: Messages }>({ language: "en", t: messages.en });
export function usePlatform() { return useContext(Context); }

export function Platform({ children, initialLanguage }: { children: ReactNode; initialLanguage: Language }) {
  const [language, setLanguage] = useState(initialLanguage);
  const t = messages[language];
  return <Context.Provider value={{ language, t }}>
    <header className="header">
      <a href="/" className="brand" aria-label="Copilot & coffee">
        <span className="brand-mark" aria-hidden="true">c<span>+</span>c</span>
        <span><strong>copilot & coffee</strong><small>{t.brand}</small></span>
      </a>
      <nav aria-label={language === "en" ? "Main navigation" : "Hauptnavigation"}>
        <a href="/">{t.workshop}</a><a href="/ideas">{t.gallery}<span aria-hidden="true"> ↗</span></a>
      </nav>
      <label className="language-control"><span className="sr-only">{t.language}</span>
        <select value={language} onChange={(event) => {
          const next = event.target.value === "de" ? "de" : "en";
          setLanguage(next);
          document.documentElement.lang = next;
          document.cookie = `spark-language=${next};path=/;max-age=31536000;SameSite=Lax${location.protocol === "https:" ? ";Secure" : ""}`;
        }}><option value="en">EN</option><option value="de">DE</option></select>
      </label>
    </header>
    <div className="pilot-strip"><span className="status-dot" />{t.demo}</div>
    <main>{children}</main>
    <footer><span className="footer-mark" aria-hidden="true">✳</span>{t.footer}<span>copilot & coffee</span></footer>
  </Context.Provider>;
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  } catch {
    throw new Error("NETWORK_ERROR");
  }
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "SERVER_ERROR");
  return result as T;
}

export function errorCode(error: unknown) {
  return error instanceof Error ? error.message : "SERVER_ERROR";
}
