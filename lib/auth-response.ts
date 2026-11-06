import { NextResponse } from "next/server";
import { AppError } from "./errors";

/** Redirects to the public signed-out page, carrying only a fixed error code. */
export function signedOut(base: string, error?: unknown) {
  const code = error instanceof AppError ? error.code : error ? "SERVER_ERROR" : "";
  if (error && !(error instanceof AppError && error.status < 500)) {
    console.error("Sign-in failed:", code, error instanceof AppError ? "" : error);
  }
  return NextResponse.redirect(new URL(code ? `/signed-out?error=${code}` : "/signed-out", base), 303);
}
