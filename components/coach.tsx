"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { IdeaFields } from "../lib/model";
import { coachHistory, type IdeaSummary } from "../lib/coach";
import { errorMessage } from "../lib/i18n";
import { errorCode, request, usePlatform } from "./platform";

type Message = {
  id: string; role: "user" | "model"; text: string; content: string;
  summary?: IdeaSummary; applied?: boolean;
};
type Reply = { content: string; text: string; summary?: IdeaSummary; invalidSummary?: boolean };

export function Coach({ fields, onApply, disabled, onActiveChange, configured }: {
  fields: IdeaFields; onApply: (summary: IdeaSummary) => void; disabled: boolean; onActiveChange: (active: boolean) => void; configured: boolean;
}) {
  const { language, t } = usePlatform();
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(true);
  const inFlight = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    active.current = true;
    return () => { active.current = false; controller.current?.abort(); };
  }, []);
  useEffect(() => { end.current?.scrollIntoView({ block: "nearest", behavior: "instant" }); }, [messages, busy]);

  async function send(event: FormEvent) {
    event.preventDefault();
    const message = text.trim();
    if (!message || inFlight.current || disabled || !configured) return;
    inFlight.current = true; setBusy(true); setError(""); onActiveChange(true);
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 55_000);
    try {
      const reply = await request<Reply>("/api/chat", {
        method: "POST", signal: abort.signal,
        body: JSON.stringify({
          language, fields: { title: fields.title, problem: fields.problem },
          messages: coachHistory(messages.map((entry) => ({ role: entry.role, text: entry.content })), message),
        }),
      });
      if (!active.current) return;
      setMessages((previous) => [...previous,
        { id: crypto.randomUUID(), role: "user", text: message, content: message },
        { id: crypto.randomUUID(), role: "model", ...reply },
      ]);
      setText("");
      setError(reply.invalidSummary ? "COACH_INVALID_SUMMARY" : "");
    } catch (error) {
      if (active.current) setError(abort.signal.aborted ? "GEMINI_TIMEOUT" : errorCode(error));
    } finally {
      clearTimeout(timeout);
      inFlight.current = false;
      if (active.current) { setBusy(false); onActiveChange(false); }
    }
  }

  return <section className="coach-panel conversation-panel" aria-label={t.coach}>
    <div className="coach-head"><span className="spark-icon" aria-hidden="true">✳</span><div><h2>{t.coach}</h2><p>{t.conversationSubtitle}</p></div><span className="pill">{t.coachBadge}</span></div>
    <div className="chat-log" role="log" aria-label={t.chatHistory} aria-live="polite">
      {!messages.length && <div className="chat-welcome"><span className="eyebrow">{t.startHere}</span><h3>{t.coachWelcome}</h3><p>{t.chatWelcome}</p>
        <button className="starter-chip" disabled={disabled || busy || !configured} onClick={() => setText(t.timeBookingStarter)}>{t.timeBookingStarter} ↗</button></div>}
      {messages.map((message) => <article key={message.id} className={`chat-message ${message.role === "model" ? "bot" : "user"}`}>
        <small>{message.role === "model" ? t.coach : t.you}</small>
        {message.text && <p>{message.text}</p>}
        {message.summary && <div className="summary-suggestion"><strong>{t.suggestedSummary}</strong>
          <dl>{Object.entries(message.summary).map(([key, value]) => <div key={key}><dt>{t[key as keyof IdeaSummary]}</dt><dd>{value}</dd></div>)}</dl>
          <button className="button secondary" disabled={disabled || busy || message.applied} onClick={() => {
            onApply(message.summary!);
            setMessages((previous) => previous.map((entry) => entry.id === message.id ? { ...entry, applied: true } : entry));
          }}>{message.applied ? t.summaryApplied : t.applySummary}</button></div>}
      </article>)}
      {busy && <p className="chat-thinking" role="status">{t.thinking}</p>}
      <div ref={end} />
    </div>
    <div className="chat-compose">
      {!configured && <p className="setup-notice" role="status">{t.agentSetup}</p>}
      {error && <p role="alert" className="alert error">{errorMessage(error, language)}</p>}
      <form onSubmit={send}><label className="sr-only" htmlFor="coach-message">{t.chatMessage}</label>
        <textarea id="coach-message" value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} rows={3}
          placeholder={t.chatPlaceholder} disabled={disabled || busy || !configured} />
        <button className="button primary" disabled={disabled || busy || !configured || !text.trim()}>{t.sendMessage} ↑</button>
      </form>
      <p className="microcopy">{t.chatPrivacy}</p>
      {messages.length > 0 && <p className="microcopy">{t.chatNotSaved}</p>}
    </div>
  </section>;
}
