"use client";

import { useState } from "react";
import { usePlatform } from "./platform";

export function EmbeddedCoach({ url, onOpen }: { url: string; onOpen: () => void }) {
  const { t } = usePlatform();
  const [opened, setOpened] = useState(false);
  return <section className="coach-panel conversation-panel embedded-coach" aria-label={t.coach}>
    <div className="coach-head"><span className="spark-icon" aria-hidden="true">✳</span><div><h2>{t.coach}</h2><p>{t.conversationSubtitle}</p></div><span className="pill">{t.coachBadge}</span></div>
    <div className="embed-instructions"><p>{t.embedSummaryHint}</p><small>{t.embedLanguageHint}</small></div>
    {opened ? <iframe className="embedded-coach-frame" src={url} title={t.embeddedChatTitle}
      allow="clipboard-write" referrerPolicy="strict-origin-when-cross-origin" /> :
      <div className="chat-welcome embed-welcome"><span className="eyebrow">{t.startHere}</span><h3>{t.coachWelcome}</h3>
        <p>{t.embedPrivacy}</p><button className="button primary" onClick={() => { setOpened(true); onOpen(); }}>{t.coachOpen} ↗</button>
      </div>}
    <div className="embed-footer"><p className="microcopy">{t.embedTroubleshooting}</p>
      <a className="text-button" href={url} target="_blank" rel="noopener noreferrer">{t.openAgentTab} ↗</a>
    </div>
  </section>;
}
