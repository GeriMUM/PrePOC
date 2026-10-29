import { randomUUID } from "node:crypto";
import { AppError } from "./errors";
import {
  commentInputSchema, commentRecordSchema, ideaRecordSchema, publishable, saveIdeaSchema,
  type Comment, type Idea, type IdeaRecord,
} from "./model";
import type { JsonStore, StoredFile } from "./storage";

const ideaKey = (id: string) => `ideas/${id}.json`;
function decode(file: StoredFile): IdeaRecord {
  return ideaRecordSchema.parse(JSON.parse(file.text));
}
function present(record: IdeaRecord, version: string): Idea {
  const { ownerId: _ownerId, ...idea } = record;
  void _ownerId;
  return { ...idea, version };
}

export class Ideas {
  constructor(private store: JsonStore) {}

  async all(ownerId?: string): Promise<Idea[]> {
    const keys = await this.store.keys("ideas/");
    const files = await Promise.all(keys.map((key) => this.store.read(key)));
    return files.flatMap((file) => {
      if (!file) return [];
      const idea = decode(file);
      if (ownerId ? idea.ownerId !== ownerId : idea.status !== "published") return [];
      return [present(idea, file.version)];
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async save(raw: unknown, ownerId: string): Promise<Idea> {
    const parsed = saveIdeaSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID_INPUT");
    const { id, version, publish, ...fields } = parsed.data;
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
      createdAt: existing?.createdAt ?? now, updatedAt: now,
    };
    const newVersion = await this.store.write(ideaKey(record.id), JSON.stringify(record), version);
    return present(record, newVersion);
  }

  private async requirePublished(id: string) {
    const file = await this.store.read(ideaKey(id));
    if (!file || decode(file).status !== "published") throw new AppError("NOT_FOUND", 404);
  }

  async comments(id: string): Promise<Comment[]> {
    await this.requirePublished(id);
    const keys = await this.store.keys(`comments/${id}/`);
    const files = await Promise.all(keys.map((key) => this.store.read(key)));
    return files.flatMap((file) => file ? [commentRecordSchema.parse(JSON.parse(file.text))] : [])
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async comment(id: string, raw: unknown): Promise<Comment> {
    await this.requirePublished(id);
    const parsed = commentInputSchema.safeParse(raw);
    if (!parsed.success) throw new AppError("INVALID_INPUT");
    const comment: Comment = { ...parsed.data, id: randomUUID(), ideaId: id, createdAt: new Date().toISOString() };
    await this.store.write(`comments/${id}/${comment.id}.json`, JSON.stringify(comment));
    return comment;
  }
}
