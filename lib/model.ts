import { z } from "zod";
import { text } from "./text";

/** Progress of an idea, visible to everyone and set by its owner. */
export const stages = ["new", "in_progress", "closed"] as const;
export const stageSchema = z.enum(stages);
export type Stage = z.infer<typeof stageSchema>;
export const idSchema = z.uuid();
export const ideaFieldsSchema = z.object({
  title: text(120),
  author: text(80),
  // When the idea should be implemented (yyyy-mm-dd), or "" when open; older records have none.
  dueDate: z.union([z.literal(""), z.iso.date()]).default(""),
  problem: text(3000),
  audience: text(1500),
  solution: text(3000),
  approach: text(2000),
  impact: text(2000),
});

// The author always comes from the signed-in user, never from the request body.
export const saveIdeaSchema = ideaFieldsSchema.omit({ author: true }).extend({
  id: idSchema.optional(),
  version: z.string().min(1).max(256).optional(),
  publish: z.boolean(),
}).strict();

export const likeInputSchema = z.object({ like: z.boolean() }).strict();
export const stageInputSchema = z.object({ stage: stageSchema }).strict();
export const maxLikes = 5000;

export const ideaRecordSchema = ideaFieldsSchema.extend({
  id: idSchema,
  ownerId: z.string().min(1).max(128),
  status: z.enum(["draft", "published"]),
  // Older records predate the progress field and count as new.
  stage: stageSchema.default("new"),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  // Set when the idea goes public; later edits move updatedAt past it, which the gallery shows as "edited".
  publishedAt: z.iso.datetime().optional(),
  // Keyed hashes of idea id + account id (see lib/ideas.ts): one like per person, no account ids
  // in the store, and nothing a browser receives reveals who liked.
  likes: z.array(z.string().min(1).max(128)).max(maxLikes).default([]),
});

export const commentInputSchema = z.object({
  text: text(1500, 1),
}).strict();

export const commentRecordSchema = commentInputSchema.extend({
  author: text(80, 1),
  authorId: z.string().min(1).max(128).optional(),
  id: idSchema,
  ideaId: idSchema,
  createdAt: z.iso.datetime(),
});

export type IdeaFields = z.infer<typeof ideaFieldsSchema>;
export type SaveIdea = z.infer<typeof saveIdeaSchema>;
export type IdeaRecord = z.infer<typeof ideaRecordSchema>;
export type CommentRecord = z.infer<typeof commentRecordSchema>;
/** What browsers see: no account id, but whether the viewer wrote the comment (and may delete it). */
export type Comment = Omit<CommentRecord, "authorId"> & { mine: boolean; deletable: boolean };
/**
 * What browsers see: an anonymous like count, whether the viewer liked, owns or may manage the idea, and,
 * for those who may manage it, a content revision (updatedAt) for optimistic edits, never the storage hash.
 */
export type Idea = Omit<IdeaRecord, "ownerId" | "likes"> & { version?: string; likes: number; liked: boolean; mine: boolean; manage: boolean };
export type Language = "en" | "de";

export function publishable(fields: IdeaFields): boolean {
  return ["title", "author", "problem"]
    .every((key) => fields[key as keyof IdeaFields].trim().length > 0);
}

export function emptyIdea(author = ""): IdeaFields {
  return { title: "", author, dueDate: "", problem: "", audience: "", solution: "", approach: "", impact: "" };
}
