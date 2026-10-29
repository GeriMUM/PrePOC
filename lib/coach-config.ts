import { z } from "zod";
import { AppError } from "./errors";

export function coachConfig() {
  const raw = process.env.COPILOT_STUDIO_TOKEN_ENDPOINT;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const domain = new URL(process.env.COPILOT_DIRECT_LINE_DOMAIN ?? "https://directline.botframework.com/v3/directline");
    if (url.protocol !== "https:" || url.username || url.password ||
      ![".environment.api.powerplatform.com", ".powerva.microsoft.com"].some((suffix) => url.hostname.endsWith(suffix)) ||
      !/\/(?:directline\/token|token)$/i.test(url.pathname) ||
      domain.protocol !== "https:" || domain.username || domain.password ||
      !(domain.hostname === "directline.botframework.com" || domain.hostname.endsWith(".directline.botframework.com")) ||
      domain.pathname.replace(/\/$/, "") !== "/v3/directline" || domain.search || domain.hash) {
      throw new Error("Invalid channel configuration");
    }
    return { tokenEndpoint: url.toString(), domain: domain.toString().replace(/\/$/, "") };
  } catch {
    throw new AppError("COACH_INVALID_CONFIG", 503);
  }
}

const tokenSchema = z.object({
  token: z.string().min(1),
  expires_in: z.number().positive().optional(),
});

export async function coachToken(fetcher: typeof fetch = fetch) {
  const config = coachConfig();
  if (!config) throw new AppError("COACH_NOT_CONFIGURED", 503);
  let response: Response;
  try {
    response = await fetcher(config.tokenEndpoint, {
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new AppError("COACH_CONNECTION_FAILED", 502);
  }
  if (!response.ok) {
    console.error("Copilot token service returned HTTP", response.status);
    throw new AppError(response.status === 401 || response.status === 403 ? "COACH_AUTH_REQUIRED" : "COACH_CONNECTION_FAILED", 502);
  }
  let parsed;
  try { parsed = tokenSchema.safeParse(await response.json()); }
  catch { throw new AppError("COACH_INVALID_RESPONSE", 502); }
  if (!parsed.success) throw new AppError("COACH_INVALID_RESPONSE", 502);
  return { token: parsed.data.token, domain: config.domain };
}
