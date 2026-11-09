import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import {
  commentInputSchema, commentRecordSchema, ideaRecordSchema, likeInputSchema, maxLikes, publishable, saveIdeaSchema,
  type Comment, type CommentRecord, type Idea, type IdeaRecord,
} from "./model";
import type { User } from "./session";
import { readAll, type JsonStore, type StoredFile } from "./storage";
import { digest } from "./tokens";

/** Caps that keep one account from filling the store or a conversation. */
export interface IdeaLimits {
  /** Drafts per account. */ drafts: number;
  /** Published ideas per account. */ published: number;
  /** Idea files in the whole store. */ total: number;
  /** Comments per idea. */ comments: number;
  /** Comments per account on one idea. */ commentsPerAuthor: number;
  /** Likes per idea. */ likes: number;
}
export const defaultLimits: IdeaLimits = { drafts: 25, published: 10, total: 2000, comments: 500, commentsPerAuthor: 30, likes: maxLikes };

const ideaKey = (id: string) => `ideas/${id}.json`;
/** Likes are stored as keyed hashes of idea id and account id: one like per person, no account ids in the store. */
const likeToken = (ideaId: string, userId: string) => digest("like", `${ideaId}:${userId}`);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function decode(file: StoredFile): IdeaRecord {
  return ideaRecordSchema.parse(JSON.parse(file.text));
}

function present(record: IdeaRecord, version: string, viewerId?: string): Idea {
  const { ownerId, likes, ...idea } = record;
  const mine = Boolean(viewerId) && ownerId === viewerId;
  return {
    ...idea,
    // The storage version is a hash of the stored record, which holds the hidden like list, so it is
    // only shared with the owner of a draft: published ideas never change through the client.
    ...(mine && record.status === "draft" ? { version } : {}),
    likes: likes.length,
    // Records written before likes were hashed hold raw account ids; both forms count as the viewer's like.
    liked: Boolean(viewerId) && (likes.includes(likeToken(record.id, viewerId ?? "")) || likes.includes(viewerId ?? "")),
    mine,
  };
}

function presentComment(record: CommentRecord, viewerId?: string): Comment {
  const { authorId, ...comment } = record;
  return { ...comment, mine: Boolean(viewerId) && authorId === viewerId };
}
const commentKey = (ideaId: string, commentId: string) => `comments/${ideaId}/${commentId}.json`;

/** Decodes every readable record; one damaged file is logged and skipped instead of failing the whole list. */
function decodeAll<T>(keys: string[], files: (StoredFile | null)[], parse: (file: StoredFile) => T): { key: string; file: StoredFile; record: T }[] {
  const records: { key: string; file: StoredFile; record: T }[] = [];
  files.forEach((file, index) => {
    if (!file) return;
    try { records.push({ key: keys[index], file, record: parse(file) }); }
    catch (error) { console.error("Skipping unreadable record", keys[index], error instanceof Error ? error.message : error); }
  });
  return records;
}

export class Ideas {
  constructor(private store: JsonStore, private limits: IdeaLimits = defaultLimits) {}

  private async scan() {
    const keys = await this.store.keys("ideas/");
    return { total: keys.length, ideas: decodeAll(keys, await readAll(this.store, keys), decode) };
  }

  async all(ownerId?: string, viewerId = ownerId): Promise<Idea[]> {
    const { ideas } = await this.scan();
    return ideas
      .filter(({ record }) => ownerId ? record.ownerId === ownerId : record.status === "published")
      .map(({ record, file }) => present(record, file.version, viewerId))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(raw: unknown, owner: User): Promise<Idea> {
    const ownerId = owner.id;
    const parsed = saveIdeaSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID_INPUT");
    const { id, version, publish, ...rest } = parsed.data;
    const fields = { ...rest, author: owner.name };
    if (publish && !publishable(fields)) throw new AppError("INCOMPLETE_IDEA");
    let existing: IdeaRecord | undefined;
    if (id) {
      const file = await this.store.read(ideaKey(id));
      if (!file) throw new AppError("NOT_FOUND", 404);
      existing = decode(file);
      if (existing.ownerId !== ownerId) throw new AppError("NOT_FOUND", 404);
      if (existing.status === "published") throw new AppError("ALREADY_PUBLISHED", 409);
      if (file.version !== version) throw new AppError("CONFLICT", 409);
    } else if (version) {
      throw new AppError("INVALID_INPUT");
    }
    if (!existing || publish) await this.checkIdeaLimits(ownerId, !existing, publish);
    const now = new Date().toISOString();
    const record: IdeaRecord = {
      ...fields, id: existing?.id ?? randomUUID(), ownerId,
      status: publish ? "published" : "draft",
      createdAt: existing?.createdAt ?? now, updatedAt: now, likes: existing?.likes ?? [],
    };
    const newVersion = await this.store.write(ideaKey(record.id), JSON.stringify(record), version);
    return present(record, newVersion, ownerId);
  }

  /** Owners can remove their own drafts; published ideas stay, so the gallery and its conversations remain consistent. */
  async deleteDraft(id: string, owner: User): Promise<void> {
    const file = await this.store.read(ideaKey(id));
    const record = file && decode(file);
    if (!file || !record || record.ownerId !== owner.id) throw new AppError("NOT_FOUND", 404);
    if (record.status === "published") throw new AppError("ALREADY_PUBLISHED", 409);
    await this.store.delete(ideaKey(id));
  }

  private async checkIdeaLimits(ownerId: string, creating: boolean, publish: boolean) {
    const { total, ideas } = await this.scan();
    const mine = ideas.filter(({ record }) => record.ownerId === ownerId);
    const count = (status: IdeaRecord["status"]) => mine.filter(({ record }) => record.status === status).length;
    if (creating && (total >= this.limits.total || (!publish && count("draft") >= this.limits.drafts))) throw new AppError("IDEA_LIMIT", 429);
    if (publish && count("published") >= this.limits.published) throw new AppError("IDEA_LIMIT", 429);
  }

  /** Adds or removes the user's like. Retries with backoff when simultaneous clicks race on the same idea. */
  async like(id: string, raw: unknown, user: User): Promise<Idea> {
    const parsed = likeInputSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID_INPUT");
    const token = likeToken(id, user.id);
    for (let attempt = 0; attempt < 8; attempt++) {
      const file = await this.store.read(ideaKey(id));
      const record = file && decode(file);
      if (!file || !record || record.status !== "published") throw new AppError("NOT_FOUND", 404);
      if (record.ownerId === user.id) throw new AppError("OWN_IDEA");
      // Also drops this user's raw account id from records written before likes were hashed.
      const others = record.likes.filter((like) => like !== token && like !== user.id);
      const already = others.length !== record.likes.length;
      if (already === parsed.data.like) return present(record, file.version, user.id);
      if (parsed.data.like && others.length >= this.limits.likes) throw new AppError("LIKE_LIMIT", 409);
      const next: IdeaRecord = { ...record, likes: parsed.data.like ? [...others, token] : others };
      try {
        return present(next, await this.store.write(ideaKey(id), JSON.stringify(next), file.version), user.id);
      } catch (error) {
        if (!(error instanceof AppError && error.code === "CONFLICT")) throw error;
        await sleep(15 + Math.random() * 60 * (attempt + 1));
      }
    }
    throw new AppError("LIKE_BUSY", 409);
  }

  private async requirePublished(id: string) {
    const file = await this.store.read(ideaKey(id));
    if (!file || decode(file).status !== "published") throw new AppError("NOT_FOUND", 404);
  }

  private async loadComments(id: string): Promise<CommentRecord[]> {
    const keys = await this.store.keys(`comments/${id}/`);
    return decodeAll(keys, await readAll(this.store, keys), (file) => commentRecordSchema.parse(JSON.parse(file.text)))
      .map(({ record }) => record)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async comments(id: string, viewerId?: string): Promise<Comment[]> {
    await this.requirePublished(id);
    return (await this.loadComments(id)).map((record) => presentComment(record, viewerId));
  }

  /** Authors can remove their own comments; everyone else gets the same answer as for a missing comment. */
  async deleteComment(ideaId: string, commentId: string, author: User): Promise<void> {
    const file = await this.store.read(commentKey(ideaId, commentId));
    const record = file && commentRecordSchema.parse(JSON.parse(file.text));
    if (!file || !record || record.authorId !== author.id) throw new AppError("NOT_FOUND", 404);
    await this.store.delete(commentKey(ideaId, commentId));
  }

  async comment(id: string, raw: unknown, author: User): Promise<Comment> {
    await this.requirePublished(id);
    const parsed = commentInputSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID_INPUT");
    const existing = await this.loadComments(id);
    const own = existing.filter((comment) => comment.authorId === author.id);
    if (existing.length >= this.limits.comments || own.length >= this.limits.commentsPerAuthor) throw new AppError("COMMENT_LIMIT", 429);
    if (own.at(-1)?.text === parsed.data.text) throw new AppError("COMMENT_DUPLICATE", 409);
    const comment: CommentRecord = {
      ...parsed.data, author: author.name, authorId: author.id, id: randomUUID(), ideaId: id, createdAt: new Date().toISOString(),
    };
    await this.store.write(commentKey(id, comment.id), JSON.stringify(comment));
    return presentComment(comment, author.id);
  }
}
