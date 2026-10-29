"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { events, type Comment, type Idea } from "../lib/model";
import { errorMessage } from "../lib/i18n";
import { errorCode, request, usePlatform } from "./platform";
import { Modal } from "./modal";

export function Gallery() {
  const { language, t } = usePlatform();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [eventId, setEventId] = useState("");
  const [selected, setSelected] = useState<Idea | null>(null);

  const load = useCallback(() =>
    request<Idea[]>("/api/ideas")
      .then((ideas) => { setIdeas(ideas); setError(""); setReady(true); })
      .catch((error: unknown) => setError(errorCode(error))), []);
  useEffect(() => { void load(); }, [load]);
  const visible = ideas.filter((idea) => (!eventId || idea.eventId === eventId) &&
    `${idea.title} ${idea.author} ${idea.problem} ${idea.solution}`.toLocaleLowerCase(language).includes(query.trim().toLocaleLowerCase(language)));

  return <div className="page-shell gallery-page">
    <section className="hero gallery-hero">
      <div><p className="eyebrow">{t.galleryEyebrow}</p><h1>{t.galleryTitle}</h1><p className="hero-description">{t.galleryIntro}</p></div>
      <a className="button primary" href="/">+ {t.newIdea}</a>
    </section>
    <p className="pilot-notice"><span aria-hidden="true">ⓘ</span> {t.warning}</p>
    <div className="gallery-toolbar">
      <label className="search-field"><span className="sr-only">{t.search}</span><span aria-hidden="true">⌕</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchPlaceholder} /></label>
      <label><span className="sr-only">{t.event}</span><select value={eventId} onChange={(event) => setEventId(event.target.value)}><option value="">{t.allEvents}</option>{events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}</select></label>
      <button className="text-button" onClick={load}>{t.refresh} ↻</button>
    </div>
    <div className="gallery-count"><span>{String(visible.length).padStart(2, "0")} {t.ideaCount}</span><span className="small-rule" /></div>
    {error && <div role="alert" className="alert error">{errorMessage(error, language)} <button className="text-button" onClick={load}>{t.retry}</button></div>}
    {!ready && !error && <p role="status">{t.loading}</p>}
    {ready && !visible.length && <div className="empty-state"><span aria-hidden="true">✳</span><h2>{ideas.length ? t.noResults : t.emptyTitle}</h2><p>{ideas.length ? t.noResultsBody : t.emptyBody}</p>{!ideas.length && <a className="button primary" href="/">{t.workshop} ↗</a>}</div>}
    <div className="idea-grid">{visible.map((idea, index) =>
      <article className={`idea-card tone-${index % 3}`} key={idea.id}>
        <div className="card-top"><span className="event-tag">{events.find((event) => event.id === idea.eventId)?.name}</span><span className="card-spark" aria-hidden="true">{["✳", "✦", "↗"][index % 3]}</span></div>
        <h2>{idea.title}</h2><p className="card-problem">{idea.problem}</p>
        <div className="card-bottom"><span className="avatar" aria-hidden="true">{idea.author.slice(0, 1).toLocaleUpperCase(language)}</span><div><strong>{idea.author}</strong><small>{new Date(idea.createdAt).toLocaleDateString(language, { day: "numeric", month: "short" })}</small></div>
          <button onClick={() => setSelected(idea)} className="round-button" aria-label={`${t.readIdea}: ${idea.title}`}>↗</button></div>
      </article>
    )}</div>
    {selected && <IdeaDetail key={selected.id} idea={selected} onClose={() => setSelected(null)} />}
  </div>;
}

function IdeaDetail({ idea, onClose }: { idea: Idea; onClose: () => void }) {
  const { language, t } = usePlatform();
  const [comments, setComments] = useState<Comment[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [author, setAuthor] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [posted, setPosted] = useState(false);
  const load = useCallback(() =>
    request("/api/session")
      .then(() => request<Comment[]>(`/api/ideas/${idea.id}/comments`))
      .then((comments) => { setComments(comments); setError(""); setReady(true); })
      .catch((error: unknown) => setError(errorCode(error))), [idea.id]);
  useEffect(() => { void load(); }, [load]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setPosted(false);
    try {
      const comment = await request<Comment>(`/api/ideas/${idea.id}/comments`, { method: "POST", body: JSON.stringify({ author, text }) });
      setComments((previous) => [...previous, comment]); setText(""); setPosted(true);
    } catch (error) { setError(errorCode(error)); }
    finally { setBusy(false); }
  }
  return <Modal title={idea.title} closeLabel={t.close} onClose={onClose} wide>
    <div className="detail-meta"><span className="event-tag">{events.find((event) => event.id === idea.eventId)?.name}</span><span>{t.by} {idea.author}</span></div>
    <div className="idea-detail">{(["problem", "audience", "solution", "approach", "impact"] as const).filter((key) => idea[key].trim()).map((key) => <section key={key}><h3>{t[key]}</h3><p>{idea[key]}</p></section>)}</div>
    <section className="comments-section"><h3>{t.comments} <span>({comments.length})</span></h3>
      {!ready && !error && <p role="status">{t.loading}</p>}
      {ready && !comments.length && <p className="microcopy">{t.noComments}</p>}
      <ol className="comments">{comments.map((comment) => <li key={comment.id}><div><strong>{comment.author}</strong><time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleDateString(language)}</time></div><p>{comment.text}</p></li>)}</ol>
      {error && <div role="alert" className="alert error">{errorMessage(error, language)}{!ready && <button className="text-button" onClick={load}>{t.retry}</button>}</div>}
      {posted && <p className="alert success" role="status">{t.commentPosted}</p>}
      <form onSubmit={submit}>
        <fieldset disabled={busy || !ready}><legend className="sr-only">{t.addComment}</legend>
          <label className="field"><span>{t.author}</span><input required value={author} maxLength={80} onChange={(event) => setAuthor(event.target.value)} placeholder={t.authorPlaceholder} /></label>
          <label className="field"><span>{t.commentLabel}</span><textarea required value={text} maxLength={1500} rows={3} onChange={(event) => { setText(event.target.value); setPosted(false); }} placeholder={t.commentPlaceholder} /><small>{text.length} / 1500</small></label>
          <button className="button primary" disabled={!author.trim() || !text.trim()}>{busy ? t.saving : t.addComment} ↗</button>
        </fieldset>
      </form>
    </section>
  </Modal>;
}
