import { createHmac, timingSafeEqual } from "node:crypto";
import { AppError } from "./errors";

function secret() {
  const value = process.env.SESSION_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production") throw new AppError("SESSION_NOT_CONFIGURED", 503);
  return "local-development-only-not-for-deployment";
}

// The purpose is part of the MAC, so a login-flow token can never be replayed as a session.
function mac(purpose: string, data: string) {
  return createHmac("sha256", secret()).update(`${purpose}.${data}`).digest("base64url");
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
