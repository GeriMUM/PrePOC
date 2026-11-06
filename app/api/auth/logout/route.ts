import { NextResponse } from "next/server";
import { origin } from "../../../../lib/auth";
import { cookieOptions, sessionCookie } from "../../../../lib/session";
import { signedOut } from "../../../../lib/auth-response";

export const dynamic = "force-dynamic";
// Signs out of this website only, not of Microsoft 365. Plain form POST, so check the origin.
export async function POST(request: Request) {
  const base = origin(request);
  if (request.headers.get("origin") !== base) return new NextResponse(null, { status: 403 });
  const response = signedOut(base);
  response.cookies.set(sessionCookie, "", cookieOptions(0));
  return response;
}
