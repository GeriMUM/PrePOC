export function coachEmbedUrl(): string | undefined {
  const raw = process.env.COPILOT_STUDIO_EMBED_URL;
  if (!raw) return undefined;
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.hostname !== "copilotstudio.microsoft.com" ||
    url.username || url.password || !/^\/environments\/[^/]+\/bots\/[^/]+\/webchat$/.test(url.pathname)) {
    throw new Error("COPILOT_STUDIO_EMBED_URL must be the HTTPS Copilot Studio webchat iframe URL.");
  }
  return url.toString();
}
