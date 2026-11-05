"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { messages, type Messages } from "../lib/i18n";
import type { Language } from "../lib/model";

const Context = createContext<{ language: Language; t: Messages }>({ language: "en", t: messages.en });
export function usePlatform() { return useContext(Context); }
export const authorKey = "cc-author";

export function Logo({ size = 44 }: { size?: number }) {
  return <svg className="logo" width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
    <rect width="100" height="100" rx="14" fill="var(--orange)" />
    <text x="12" y="66" fill="#fff" fontSize="22" fontWeight="500" letterSpacing="-.5">mann&amp;</text>
    <text x="12" y="86" fill="#fff" fontSize="22" fontWeight="500" letterSpacing="-.5">mouse</text>
  </svg>;
}

function persistLanguage(next: Language) {
  document.documentElement.lang = next;
  document.cookie = `spark-language=${next};path=/;max-age=31536000;SameSite=Lax${location.protocol === "https:" ? ";Secure" : ""}`;
}

export function Platform({ children, initialLanguage }: { children: ReactNode; initialLanguage: Language }) {
  const [language, setLanguage] = useState(initialLanguage);
  const pathname = usePathname();
  const t = messages[language];
  function switchLanguage(next: Language) {
    setLanguage(next);
    persistLanguage(next);
  }
  return <Context.Provider value={{ language, t }}>
    <header className="header">
      <div className="header-inner">
        <a href="/" className="brand" aria-label="copilot & coffee – mann&mouse">
          <Logo />
          <span><strong>copilot &amp; coffee</strong><small>{t.brand}</small></span>
        </a>
        <nav aria-label={language === "en" ? "Main navigation" : "Hauptnavigation"}>
          <a href="/" aria-current={pathname === "/" ? "page" : undefined}>{t.workshop}</a>
          <a href="/ideas" aria-current={pathname.startsWith("/ideas") ? "page" : undefined}>{t.gallery}</a>
        </nav>
        <div className="language-control" role="group" aria-label={t.language}>
          {(["de", "en"] as const).map((code) =>
            <button key={code} type="button" aria-pressed={language === code} onClick={() => switchLanguage(code)}>{code.toUpperCase()}</button>)}
        </div>
      </div>
    </header>
    <main>{children}</main>
    <footer className="footer"><div className="footer-inner"><span>{t.footer}</span><span>{t.demo}</span><span className="footer-brand">mann&amp;mouse · we live it</span></div></footer>
  </Context.Provider>;
}

export async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers }, cache: "no-store" });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new Error("NETWORK_ERROR");
  }
  // Proxies and platform timeouts can answer with HTML instead of JSON.
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "SERVER_ERROR";
    throw new Error(code);
  }
  if (result === null) throw new Error("SERVER_ERROR");
  return result as T;
}

export function errorCode(error: unknown) {
  return error instanceof Error ? error.message : "SERVER_ERROR";
}
