import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { callbackUrl, entraConfig, finishLogin, flowCookie, origin } from "../../../../lib/auth";
import { redirectTo, signedOut } from "../../../../lib/auth-response";
import { AppError } from "../../../../lib/errors";
import { Quota } from "../../../../lib/quota";
import { cookieOptions, sessionCookie, sessionMaxAge, userToken } from "../../../../lib/session";
import { storage } from "../../../../lib/storage";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const base = origin(request);
  const flow = (await cookies()).get(flowCookie)?.value;
  let response: NextResponse;
  try {
    const config = entraConfig();
    if (!config) throw new AppError("AUTH_NOT_CONFIGURED", 503);
    const quota = new Quota(storage());
    const { user, returnTo } = await finishLogin(config, callbackUrl(request), new URL(request.url).searchParams, flow, {
      // Each login attempt may reach the token endpoint once; a replayed callback is refused.
      guard: (state) => quota.consume("flow", state, 1, "AUTH_FAILED"),
    });
    response = redirectTo(new URL(returnTo, base));
    response.cookies.set(sessionCookie, userToken(user), cookieOptions(sessionMaxAge));
  } catch (error) {
    response = signedOut(base, error);
  }
  response.cookies.set(flowCookie, "", cookieOptions(0, "/api/auth"));
  return response;
}
