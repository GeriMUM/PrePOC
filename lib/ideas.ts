import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import {
  commentInputSchema, commentRecordSchema, ideaRecordSchema, publishable, saveIdeaSchema, likeInputSchema,
  type Comment, type CommentRecord, type Idea, type IdeaRecord,
} from "./model";
import type { User } from "./session";
import type { JsonStore, StoredFile } from "./storage";

const ideaKey = (id: string) => `ideas/${id}.json`;
function decode(file: StoredFile): IdeaRecord {
  return ideaRecordSchema.parse(JSON.parse(file.text));
}
function present(record: IdeaRecord, version: string, viewerId?: string): Idea {
  const { ownerId, likes, ...idea } = record;
  return {
    ...idea, version, likes: likes.length,
    liked: Boolean(viewerId) && likes.includes(viewerId ?? ""),
    mine: Boolean(viewerId) && ownerId === viewerId,
  };
}

function presentComment(record: CommentRecord): Comment {
  const { authorId: _authorId, ...comment } = record;
  void _authorId;
  return comment;
}

export class Ideas {
  constructor(private store: JsonStore) {}

  async all(ownerId?: string, viewerId = ownerId): Promise<Idea[]> {
    const keys = await this.store.keys("ideas/");
    const files = await Promise.all(keys.map((key) => this.store.read(key)));
    return files.flatMap((file) => {
      if (!file) return [];
      const idea = decode(file);
      if (ownerId ? idea.ownerId !== ownerId : idea.status !== "published") return [];
      return [present(idea, file.version, viewerId)];
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
    const now = new Date().toISOString();
    const record: IdeaRecord = {
      ...fields, id: existing?.id ?? randomUUID(), ownerId,
      status: publish ? "published" : "draft",
      createdAt: existing?.createdAt ?? now, updatedAt: now, likes: existing?.likes ?? [],
    };
    const newVersion = await this.store.write(ideaKey(record.id), JSON.stringify(record), version);
    return present(record, newVersion, ownerId);
  }

  /** Adds or removes the user's like. Retries when simultaneous clicks race on the same idea. */
  async like(id: string, raw: unknown, user: User): Promise<Idea> {
    const parsed = likeInputSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID_INPUT");
    for (let attempt = 0; attempt < 5; attempt++) {
      const file = await this.store.read(ideaKey(id));
      const record = file && decode(file);
      if (!file || !record || record.status !== "published") throw new AppError("NOT_FOUND", 404);
      if (record.ownerId === user.id) throw new AppError("OWN_IDEA");
      const others = record.likes.filter((id) => id !== user.id);
      const already = others.length !== record.likes.length;
      if (already === parsed.data.like) return present(record, file.version, user.id);
      const next: IdeaRecord = { ...record, likes: parsed.data.like ? [...others, user.id] : others };
      try {
        return present(next, await this.store.write(ideaKey(id), JSON.stringify(next), file.version), user.id);
      } catch (error) {
        if (!(error instanceof AppError && error.code === "CONFLICT")) throw error;
      }
    }
    throw new AppError("CONFLICT", 409);
  }

  private async requirePublished(id: string) {
    const file = await this.store.read(ideaKey(id));
    if (!file || decode(file).status !== "published") throw new AppError("NOT_FOUND", 404);
  }

  async comments(id: string): Promise<Comment[]> {
    await this.requirePublished(id);
    const keys = await this.store.keys(`comments/${id}/`);
    const files = await Promise.all(keys.map((key) => this.store.read(key)));
    return files.flatMap((file) => file ? [presentComment(commentRecordSchema.parse(JSON.parse(file.text)))] : [])
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async comment(id: string, raw: unknown, author: User): Promise<Comment> {
    await this.requirePublished(id);
    const parsed = commentInputSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID_INPUT");
    const comment: CommentRecord = {
      ...parsed.data, author: author.name, authorId: author.id, id: randomUUID(), ideaId: id, createdAt: new Date().toISOString(),
    };
    await this.store.write(`comments/${id}/${comment.id}.json`, JSON.stringify(comment));
    return presentComment(comment);
  }
}
