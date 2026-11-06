import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError } from "./errors";
import type { User } from "./session";
import { equal, sign, verify } from "./tokens";

/** Single-tenant Microsoft Entra ID sign-in (OpenID Connect authorization code flow with PKCE). */
export interface EntraConfig { tenantId: string; clientId: string; clientSecret: string }

type Env = Record<string, string | undefined>;
const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const flowCookie = "cc-login";
export const flowMaxAge = 600;
export const devUser: User = { id: "local-developer", name: "Local Developer" };

export function entraConfig(env: Env = process.env): EntraConfig | null {
  const tenantId = env.ENTRA_TENANT_ID?.trim().toLowerCase();
  const clientId = env.ENTRA_CLIENT_ID?.trim().toLowerCase();
  const clientSecret = env.ENTRA_CLIENT_SECRET?.trim();
  if (!tenantId && !clientId && !clientSecret) return null;
  // A tenant GUID (not "common"/"organizations") keeps sign-in limited to the company directory.
  if (!tenantId || !guid.test(tenantId) || !clientId || !guid.test(clientId) || !clientSecret) {
    throw new AppError("AUTH_INVALID_CONFIG", 503);
  }
  return { tenantId, clientId, clientSecret };
}

/** Without Entra configuration, local development signs in as a fixed test user. Never on Vercel or in production. */
export function devLoginAllowed(env: Env = process.env) {
  return env.NODE_ENV !== "production" && !env.VERCEL;
}

export function safeReturnTo(value: string | null | undefined): string {
  return value && /^\/(?!\/)[\w\-/]*$/.test(value) ? value : "/";
}

const authority = (config: EntraConfig) => `https://login.microsoftonline.com/${config.tenantId}`;
const random = () => randomBytes(32).toString("base64url");
const flowSchema = z.object({ state: z.string(), nonce: z.string(), verifier: z.string(), returnTo: z.string(), exp: z.number() });

export function startLogin(config: EntraConfig, redirectUri: string, returnTo: string, now = Date.now()) {
  const state = random(), nonce = random(), verifier = random();
  const url = new URL(`${authority(config)}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({
    client_id: config.clientId, response_type: "code", response_mode: "query", redirect_uri: redirectUri,
    scope: "openid profile", state, nonce,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256",
  }).toString();
  const flow = sign("flow", { state, nonce, verifier, returnTo: safeReturnTo(returnTo), exp: Math.floor(now / 1000) + flowMaxAge });
  return { url: url.toString(), flow };
}

const tokenResponseSchema = z.object({ id_token: z.string() });
const claimsSchema = z.object({
  aud: z.string(), iss: z.string(), tid: z.string(), oid: z.string().regex(guid), nonce: z.string(), exp: z.number(),
  name: z.string().optional(), preferred_username: z.string().optional(),
});

function decodeClaims(idToken: string): unknown {
  const [, payload] = idToken.split(".");
  try { return JSON.parse(Buffer.from(payload ?? "", "base64url").toString("utf8")); } catch { return null; }
}

export async function finishLogin(
  config: EntraConfig, redirectUri: string, params: URLSearchParams, flowToken: string | undefined,
  fetcher: typeof fetch = fetch, now = Date.now(),
): Promise<{ user: User; returnTo: string }> {
  const flow = flowSchema.safeParse(verify("flow", flowToken));
  if (!flow.success || flow.data.exp <= now / 1000) throw new AppError("AUTH_FLOW_EXPIRED");
  if (!equal(params.get("state") ?? "", flow.data.state)) throw new AppError("AUTH_FAILED");
  const providerError = params.get("error");
  if (providerError) throw new AppError(providerError === "access_denied" ? "AUTH_DENIED" : "AUTH_FAILED", 403);
  const code = params.get("code");
  if (!code) throw new AppError("AUTH_FAILED");

  let response: Response;
  try {
    response = await fetcher(`${authority(config)}/oauth2/v2.0/token`, {
      method: "POST", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: config.clientId, client_secret: config.clientSecret, grant_type: "authorization_code",
        code, redirect_uri: redirectUri, code_verifier: flow.data.verifier, scope: "openid profile",
      }),
    });
  } catch {
    throw new AppError("AUTH_UNAVAILABLE", 502);
  }
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = result && typeof result === "object" && "error" in result ? String(result.error).slice(0, 64) : "unknown";
    console.error("Entra token endpoint returned HTTP", response.status, code);
    throw new AppError(code === "invalid_client" || code === "unauthorized_client" ? "AUTH_INVALID_CONFIG" : "AUTH_FAILED", 502);
  }
  const tokens = tokenResponseSchema.safeParse(result);
  const claims = claimsSchema.safeParse(tokens.success ? decodeClaims(tokens.data.id_token) : null);
  if (!claims.success) throw new AppError("AUTH_FAILED", 502);
  const { aud, iss, tid, oid, nonce, exp, name, preferred_username } = claims.data;
  // The ID token comes straight from Entra's token endpoint over TLS in exchange for our client
  // secret, so TLS authenticates the issuer (OpenID Connect Core 1.0, section 3.1.3.7, rule 6).
  // The claims are still checked so a token for another app, tenant, or login attempt is refused.
  if (aud.toLowerCase() !== config.clientId || iss !== `${authority(config)}/v2.0` || tid.toLowerCase() !== config.tenantId ||
    !equal(nonce, flow.data.nonce) || exp <= now / 1000 - 300) {
    throw new AppError("AUTH_FAILED", 403);
  }
  const displayName = (name?.trim() || preferred_username?.trim() || "").slice(0, 80);
  if (!displayName) throw new AppError("AUTH_FAILED", 403);
  return { user: { id: oid.toLowerCase(), name: displayName }, returnTo: flow.data.returnTo };
}

/** The externally visible origin, consistent with the same-origin check in lib/api.ts. */
export function origin(request: Request) {
  const url = new URL(request.url);
  return `${url.protocol}//${request.headers.get("host") ?? url.host}`;
}
export const callbackUrl = (request: Request) => `${origin(request)}/api/auth/callback`;
