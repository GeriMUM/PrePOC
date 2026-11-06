"use client";

import { errorMessage } from "../lib/i18n";
import { usePlatform } from "./platform";

export function SignedOut({ error }: { error: string }) {
  const { language, t } = usePlatform();
  return <div className="page-shell signed-out">
    <section className="hero">
      <h1>{t.signedOutTitle}</h1><p className="hero-description">{t.signedOutBody}</p>
    </section>
    {error && <div role="alert" className="alert error">{errorMessage(error, language)}</div>}
    <a className="button primary" href="/api/auth/login">{t.signIn}</a>
  </div>;
}
