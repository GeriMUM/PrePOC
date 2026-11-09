import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

// Survives hot reloads in development, so sessions do not drop with every code change.
const state = globalThis as { __ccDevelopmentSecret?: string };

function secret() {
  const env = process.env;
  const value = env.SESSION_SECRET;
  if (value && value.length >= 32) return value;
  // Anything deployed, or holding real credentials, must configure the secret explicitly.
  if (env.NODE_ENV === "production" || env.VERCEL || env.ENTRA_CLIENT_SECRET || env.BLOB_READ_WRITE_TOKEN || env.BLOB_STORE_ID) {
    throw new AppError("SESSION_NOT_CONFIGURED", 503);
  }
  // Local development without a secret: a random key per process, never a committed constant.
  state.__ccDevelopmentSecret ??= randomBytes(32).toString("base64url");
  return state.__ccDevelopmentSecret;
}

// The purpose is part of the MAC, so a login-flow token can never be replayed as a session.
function mac(purpose: string, data: string) {
  return createHmac("sha256", secret()).update(`${purpose}.${data}`).digest("base64url");
}

/** A keyed, purpose-bound hash: stable for the same input, unguessable without the secret. */
export function digest(purpose: string, value: string) {
  return createHmac("sha256", secret()).update(`${purpose}.${value}`).digest("hex");
}

export function equal(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function sign(purpose: string, payload: unknown): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${mac(purpose, data)}`;
}

export function verify(purpose: string, token: string | undefined): unknown {
  if (!token) return null;
  const [data, supplied, extra] = token.split(".");
  if (!data || !supplied || extra !== undefined || !equal(mac(purpose, data), supplied)) return null;
  try { return JSON.parse(Buffer.from(data, "base64url").toString("utf8")); } catch { return null; }
}
