import { z } from "zod";

export const events = [
  { id: "coffee-1", name: "copilot&coffe vol 1" },
  { id: "coffee-2", name: "copilot & coffe vol 2" },
] as const;

export const eventSchema = z.enum(["coffee-1", "coffee-2"]);
export const idSchema = z.uuid();
export const ideaFieldsSchema = z.object({
  title: z.string().trim().max(120),
  author: z.string().trim().max(80),
  eventId: eventSchema,
  problem: z.string().trim().max(3000),
  audience: z.string().trim().max(1500),
  solution: z.string().trim().max(3000),
  approach: z.string().trim().max(2000),
  impact: z.string().trim().max(2000),
});

export const saveIdeaSchema = ideaFieldsSchema.extend({
  id: idSchema.optional(),
  version: z.string().min(1).max(256).optional(),
  publish: z.boolean(),
}).strict();

export const ideaRecordSchema = ideaFieldsSchema.extend({
  id: idSchema,
  ownerId: idSchema,
  status: z.enum(["draft", "published"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const commentInputSchema = z.object({
  author: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(1500),
}).strict();

export const commentRecordSchema = commentInputSchema.extend({
  id: idSchema,
  ideaId: idSchema,
  createdAt: z.iso.datetime(),
});

export type IdeaFields = z.infer<typeof ideaFieldsSchema>;
export type SaveIdea = z.infer<typeof saveIdeaSchema>;
export type IdeaRecord = z.infer<typeof ideaRecordSchema>;
export type Comment = z.infer<typeof commentRecordSchema>;
export type Idea = Omit<IdeaRecord, "ownerId"> & { version: string };
export type Language = "en" | "de";

export function publishable(fields: IdeaFields): boolean {
  return ["title", "author", "problem"]
    .every((key) => fields[key as keyof IdeaFields].trim().length > 0);
}

export function emptyIdea(author = ""): IdeaFields {
  return { title: "", author, eventId: "coffee-1", problem: "", audience: "", solution: "", approach: "", impact: "" };
}
