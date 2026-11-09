import { z } from "zod";
import { text } from "./text";

export const events = [
  { id: "coffee-1", name: "copilot & coffee vol. 1" },
  { id: "coffee-2", name: "copilot & coffee vol. 2" },
] as const;

export const eventSchema = z.enum(["coffee-1", "coffee-2"]);
export const idSchema = z.uuid();
export const ideaFieldsSchema = z.object({
  title: text(120),
  author: text(80),
  eventId: eventSchema,
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
export const maxLikes = 5000;

export const ideaRecordSchema = ideaFieldsSchema.extend({
  id: idSchema,
  ownerId: z.string().min(1).max(128),
  status: z.enum(["draft", "published"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
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
export type Comment = Omit<CommentRecord, "authorId">;
/**
 * What browsers see: an anonymous like count, whether the viewer liked or owns the idea, and the
 * storage version only for the viewer's own drafts (published ideas never change through the client).
 */
export type Idea = Omit<IdeaRecord, "ownerId" | "likes"> & { version?: string; likes: number; liked: boolean; mine: boolean };
export type Language = "en" | "de";

export function publishable(fields: IdeaFields): boolean {
  return ["title", "author", "problem"]
    .every((key) => fields[key as keyof IdeaFields].trim().length > 0);
}

export function emptyIdea(author = ""): IdeaFields {
  return { title: "", author, eventId: "coffee-1", problem: "", audience: "", solution: "", approach: "", impact: "" };
}
