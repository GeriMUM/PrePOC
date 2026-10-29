"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emptyIdea, events, publishable, type Idea, type IdeaFields } from "../lib/model";
import type { IdeaSummary } from "../lib/coach";
import { errorMessage } from "../lib/i18n";
import { Coach } from "./coach";
import { Modal } from "./modal";
import { errorCode, request, usePlatform } from "./platform";

export function Workshop({ coachConfigured }: { coachConfigured: boolean }) {
  const { language, t } = usePlatform();
  const [fields, setFields] = useState<IdeaFields>(emptyIdea);
  const [current, setCurrent] = useState<Idea | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<"saved" | "publishedNotice" | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [conversationKey, setConversationKey] = useState(0);
  const [coachActive, setCoachActive] = useState(false);
  const [hasConversation, setHasConversation] = useState(false);
  const feedback = useRef<HTMLDivElement>(null);
  const saving = useRef(false);
  const readonly = current?.status === "published";

  const load = useCallback(() =>
    request("/api/session")
      .then(() => request<Idea[]>("/api/ideas?mine=1"))
      .then((ideas) => { setIdeas(ideas); setError(""); setReady(true); })
      .catch((error: unknown) => setError(errorCode(error))), []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!dirty && !hasConversation) return;
    const leave = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty, hasConversation]);
  useEffect(() => {
    if (error || notice) feedback.current?.scrollIntoView({ block: "nearest", behavior: "instant" });
  }, [error, notice]);

  function update<K extends keyof IdeaFields>(key: K, value: IdeaFields[K]) {
    setFields((previous) => ({ ...previous, [key]: value })); setDirty(true); setNotice(null); setError("");
  }
  function open(id: string) {
    if ((dirty || hasConversation) && !window.confirm(t.leaveConversation)) return;
    const idea = ideas.find((idea) => idea.id === id);
    setFields(idea ?? emptyIdea(fields.author)); setCurrent(idea ?? null);
    setDirty(false); setError(""); setNotice(null); setHasConversation(false);
    setConversationKey((value) => value + 1);
  }
  async function save(publish: boolean) {
    if (saving.current) return;
    if (publish && !publishable(fields)) { setError("INCOMPLETE_IDEA"); return; }
    saving.current = true; setBusy(true); setError(""); setNotice(null);
    try {
      const saved = await request<Idea>("/api/ideas", {
        method: "POST",
        body: JSON.stringify({
          ...Object.fromEntries(Object.keys(emptyIdea()).map((key) => [key, fields[key as keyof IdeaFields]])),
          ...(current ? { id: current.id, version: current.version } : {}), publish,
        }),
      });
      setCurrent(saved); setFields(saved);
      setIdeas((previous) => [saved, ...previous.filter((idea) => idea.id !== saved.id)]);
      setDirty(false); setNotice(publish ? "publishedNotice" : "saved"); setConfirm(false);
    } catch (error) { setError(errorCode(error)); setConfirm(false); }
    finally { setBusy(false); saving.current = false; }
  }
  function apply(summary: IdeaSummary) {
    setFields((previous) => ({ ...previous, ...Object.fromEntries(Object.entries(summary).filter(([, value]) => value?.trim())) }));
    setDirty(true); setNotice(null); setError("");
  }

  const prompt = (key: "problem" | "audience" | "solution" | "approach" | "impact", max: number, rows = 3) =>
    <label className="field" key={key}><span>{t[key]} {key !== "problem" && <em>{t.optional}</em>}</span>
      <textarea name={key} value={fields[key]} onChange={(event) => update(key, event.target.value)}
        placeholder={key === "approach" ? t.approachOptionalPlaceholder : t[`${key}Placeholder`]} maxLength={max} rows={rows} />
      <small>{fields[key].length.toLocaleString(language)} / {max.toLocaleString(language)}</small>
    </label>;

  return <div className="page-shell">
    <section className="hero workshop-hero">
      <div><p className="eyebrow">{t.eyebrow}</p><h1>{t.hero}</h1><p className="hero-description">{t.conversationIntro}</p></div>
      <div className="hero-stamp" aria-hidden="true"><span>IDEAS<br />BREWING</span><b>✳</b><small>vol. 01 — 02</small></div>
    </section>
    <p className="pilot-notice"><span aria-hidden="true">ⓘ</span> {t.warning}</p>
    <div className="draft-bar">
      <label><span>{t.drafts}</span><select aria-label={t.selectDraft} value={current?.id ?? ""} disabled={!ready || busy || coachActive} onChange={(event) => open(event.target.value)}>
        <option value="">{t.newIdea}</option>{ideas.map((idea) => <option key={idea.id} value={idea.id}>{idea.title || t.untitled} · {idea.status === "draft" ? t.draft : t.published}</option>)}
      </select></label>
      <button className="text-button" onClick={() => open("")} disabled={busy || coachActive}>+ {t.newIdea}</button>
    </div>
    <div className="conversation-layout">
      <Coach key={conversationKey} configured={coachConfigured} fields={fields} disabled={busy || readonly || !ready}
        onApply={apply} onActiveChange={(active) => { setCoachActive(active); if (active) setHasConversation(true); }} />
      <section className="editor-panel summary-panel" aria-label={t.ideaSummary}>
        <div className="editor-top"><span className="pill">{readonly ? t.published : t.draft}</span><span className="save-status">{dirty ? <><i />{t.unsaved}</> : current ? t.savedLabel : ""}</span></div>
        <div className="summary-heading"><h2>{t.ideaSummary}</h2><p>{t.summaryHint}</p></div>
        <fieldset disabled={busy || readonly || !ready}>
          <legend className="sr-only">{t.ideaSummary}</legend>
          <div className="basics">
            <label className="field title-field"><span>{t.title}</span><input name="title" placeholder={t.titlePlaceholder} value={fields.title} onChange={(event) => update("title", event.target.value)} maxLength={120} /></label>
            <div className="two-fields">
              <label className="field"><span>{t.author}</span><input name="author" autoComplete="nickname" placeholder={t.authorPlaceholder} value={fields.author} onChange={(event) => update("author", event.target.value)} maxLength={80} /></label>
              <label className="field"><span>{t.event}</span><select value={fields.eventId} onChange={(event) => update("eventId", event.target.value === "coffee-2" ? "coffee-2" : "coffee-1")}>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
            </div>
          </div>
          <div className="summary-fields">
            {prompt("problem", 3000)}
          </div>
        </fieldset>
        <div className="save-feedback" ref={feedback}>
          {!ready && !error && <p role="status">{t.loading}</p>}
          {error && <div role="alert" className="alert error">{errorMessage(error, language)}
            {!ready && <button className="text-button" onClick={load}>{t.retry}</button>}
          </div>}
          {notice && <p role="status" className="alert success">{t[notice]} {notice === "publishedNotice" && <a href="/ideas">{t.gallery} ↗</a>}</p>}
        </div>
        <div className="editor-actions">
          {readonly ? <p>{t.readonly} <a href="/ideas">{t.gallery} ↗</a></p> : <>
            <button className="button secondary" disabled={busy || !ready} onClick={() => save(false)}>{busy ? t.saving : t.save}</button>
            <button className="button primary" disabled={busy || !ready || coachActive} onClick={() => {
              if (!publishable(fields)) { setError("INCOMPLETE_IDEA"); return; }
              setConfirm(true);
            }}>{t.publish} <span aria-hidden="true">↗</span></button>
          </>}
        </div>
        {!readonly && <p className="publish-help">{t.publishRequirements}</p>}
      </section>
    </div>
    {confirm && <Modal title={t.publishTitle} closeLabel={t.cancel} onClose={() => { if (!busy) setConfirm(false); }}>
      <p>{t.publishDescription}</p><div className="modal-actions"><button className="button secondary" disabled={busy} onClick={() => setConfirm(false)}>{t.cancel}</button>
        <button className="button primary" disabled={busy} onClick={() => save(true)}>{busy ? t.saving : t.publishConfirm}</button></div>
    </Modal>}
  </div>;
}
