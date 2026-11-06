"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { events, type Comment, type Idea } from "../lib/model";
import { errorMessage } from "../lib/i18n";
import { errorCode, formatDate, request, usePlatform } from "./platform";
import { Modal } from "./modal";

const ideaPath = /^\/ideas\/([0-9a-f-]{36})$/i;

export function Gallery({ initialId = "" }: { initialId?: string }) {
  const { language, t } = usePlatform();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [eventId, setEventId] = useState("");
  const [selected, setSelected] = useState<Idea | null>(null);
  const [missing, setMissing] = useState(false);
  const pending = useRef(initialId);
  const pushed = useRef(false);
  const ideasRef = useRef<Idea[]>([]);

  const load = useCallback(() =>
    request<Idea[]>("/api/ideas")
      .then((ideas) => {
        setIdeas(ideas); ideasRef.current = ideas; setError(""); setReady(true);
        if (pending.current) {
          const idea = ideas.find((idea) => idea.id === pending.current);
          setSelected(idea ?? null); setMissing(!idea); pending.current = "";
        }
      })
      .catch((error: unknown) => setError(errorCode(error))), []);
  useEffect(() => { void load(); }, [load]);
  // Browser back/forward between /ideas and /ideas/<id> opens or closes the idea.
  useEffect(() => {
    const sync = () => {
      pushed.current = false;
      const id = ideaPath.exec(location.pathname)?.[1];
      setSelected(ideasRef.current.find((idea) => idea.id === id) ?? null);
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  function open(idea: Idea) {
    setSelected(idea); setMissing(false);
    if (location.pathname !== `/ideas/${idea.id}`) { history.pushState(null, "", `/ideas/${idea.id}`); pushed.current = true; }
  }
  function close() {
    setSelected(null);
    if (pushed.current) { pushed.current = false; history.back(); }
    else if (location.pathname !== "/ideas") history.replaceState(null, "", "/ideas");
  }
  const visible = ideas.filter((idea) => (!eventId || idea.eventId === eventId) &&
    `${idea.title} ${idea.author} ${idea.problem} ${idea.solution}`.toLocaleLowerCase(language).includes(query.trim().toLocaleLowerCase(language)));

  return <div className="page-shell gallery-page">
    <section className="hero gallery-hero">
      <div><p className="eyebrow">{t.galleryEyebrow}</p><h1>{t.galleryTitle}</h1><p className="hero-description">{t.galleryIntro}</p></div>
      <a className="button primary" href="/">+ {t.newIdea}</a>
    </section>
    <div className="gallery-toolbar">
      <label className="search-field"><span className="sr-only">{t.search}</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchPlaceholder} /></label>
      <label><span className="sr-only">{t.event}</span><select value={eventId} onChange={(event) => setEventId(event.target.value)}><option value="">{t.allEvents}</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
      <button className="button secondary" onClick={load}>{t.refresh}</button>
    </div>
    <p className="gallery-count">{visible.length} {visible.length === 1 ? t.ideaCountOne : t.ideaCount}</p>
    {missing && <div role="alert" className="alert error">{errorMessage("NOT_FOUND", language)}</div>}
    {error && <div role="alert" className="alert error">{errorMessage(error, language)} <button className="text-button" onClick={load}>{t.retry}</button></div>}
    {!ready && !error && <p role="status" className="microcopy">{t.loading}</p>}
    {ready && !visible.length && <div className="empty-state"><h2>{ideas.length ? t.noResults : t.emptyTitle}</h2><p>{ideas.length ? t.noResultsBody : t.emptyBody}</p>{!ideas.length && <a className="button primary" href="/">{t.workshop}</a>}</div>}
    <div className="idea-grid">{visible.map((idea) =>
      <button type="button" className="idea-card" key={idea.id} onClick={() => open(idea)} aria-label={`${t.readIdea}: ${idea.title}`}>
        <span className="event-tag">{events.find((event) => event.id === idea.eventId)?.name}</span>
        <h2>{idea.title}</h2><p className="card-problem">{idea.problem}</p>
        <span className="card-bottom"><span className="avatar" aria-hidden="true">{idea.author.slice(0, 1).toLocaleUpperCase(language)}</span><span><strong>{idea.author}</strong><small>{formatDate(idea.createdAt, language)}</small></span>
          <span className="card-arrow" aria-hidden="true">→</span></span>
      </button>
    )}</div>
    {selected && <IdeaDetail key={selected.id} idea={selected} onClose={close} />}
  </div>;
}

function IdeaDetail({ idea, onClose }: { idea: Idea; onClose: () => void }) {
  const { language, t } = usePlatform();
  const [comments, setComments] = useState<Comment[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);
  const [copied, setCopied] = useState(false);
  const load = useCallback(() =>
    request<Comment[]>(`/api/ideas/${idea.id}/comments`)
      .then((comments) => { setComments(comments); setError(""); setReady(true); })
      .catch((error: unknown) => setError(errorCode(error))), [idea.id]);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setPosted(false);
    try {
      const comment = await request<Comment>(`/api/ideas/${idea.id}/comments`, { method: "POST", body: JSON.stringify({ text }) });
      setComments((previous) => [...previous, comment]); setText(""); setPosted(true);
    } catch (error) { setError(errorCode(error)); }
    finally { setBusy(false); }
  }
  async function copyLink() {
    const url = `${location.origin}/ideas/${idea.id}`;
    try { await navigator.clipboard.writeText(url); setCopied(true); }
    catch { window.prompt(t.copyLink, url); }
  }
  return <Modal title={idea.title} closeLabel={t.close} onClose={onClose} wide>
    <div className="detail-meta"><span className="event-tag">{events.find((event) => event.id === idea.eventId)?.name}</span><span>{t.by} {idea.author}</span>
      <button type="button" className="text-button copy-link" onClick={copyLink}>{copied ? `✓ ${t.linkCopied}` : `🔗 ${t.copyLink}`}</button></div>
    <div className="idea-detail">{(["problem", "audience", "solution", "approach", "impact"] as const).filter((key) => idea[key].trim()).map((key) => <section key={key}><h3>{t[`${key}Heading`]}</h3><p>{idea[key]}</p></section>)}</div>
    <section className="comments-section"><h3>{t.comments} <span>({comments.length})</span></h3>
      {!ready && !error && <p role="status">{t.loading}</p>}
      {ready && !comments.length && <p className="microcopy">{t.noComments}</p>}
      <ol className="comments">{comments.map((comment) => <li key={comment.id}><div><strong>{comment.author}</strong><time dateTime={comment.createdAt}>{formatDate(comment.createdAt, language)}</time></div><p>{comment.text}</p></li>)}</ol>
      {error && <div role="alert" className="alert error">{errorMessage(error, language)}{!ready && <button className="text-button" onClick={load}>{t.retry}</button>}</div>}
      {posted && <p className="alert success" role="status">{t.commentPosted}</p>}
      <form onSubmit={submit}>
        <fieldset disabled={busy || !ready}><legend className="sr-only">{t.addComment}</legend>
          <label className="field"><span>{t.commentLabel}</span><textarea required value={text} maxLength={1500} rows={3} onChange={(event) => { setText(event.target.value); setPosted(false); }} placeholder={t.commentPlaceholder} /><small>{text.length} / 1500</small></label>
          <button className="button primary" disabled={!text.trim()}>{busy ? t.saving : t.addComment}</button>
        </fieldset>
      </form>
    </section>
  </Modal>;
}
