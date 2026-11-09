import { NextResponse } from "next/server";
import { AppError } from "./errors";

/** Sign-in responses carry cookies and one-time codes, so no cache may ever keep them. */
export function redirectTo(url: string | URL, status: 302 | 303 | 307 = 303) {
  return NextResponse.redirect(url, { status, headers: { "Cache-Control": "no-store" } });
}

/** Redirects to the public signed-out page, carrying only a fixed error code. */
export function signedOut(base: string, error?: unknown) {
  const code = error instanceof AppError ? error.code : error ? "SERVER_ERROR" : "";
  if (error && !(error instanceof AppError && error.status < 500)) {
    console.error("Sign-in failed:", code, error instanceof AppError ? "" : error);
  }
  return redirectTo(new URL(code ? `/signed-out?error=${code}` : "/signed-out", base));
}
