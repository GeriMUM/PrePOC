import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { callbackUrl, entraConfig, finishLogin, flowCookie, origin } from "../../../../lib/auth";
import { AppError } from "../../../../lib/errors";
import { cookieOptions, sessionCookie, sessionMaxAge, userToken } from "../../../../lib/session";
import { signedOut } from "../../../../lib/auth-response";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const base = origin(request);
  const flow = (await cookies()).get(flowCookie)?.value;
  let response: NextResponse;
  try {
    const config = entraConfig();
    if (!config) throw new AppError("AUTH_NOT_CONFIGURED", 503);
    const { user, returnTo } = await finishLogin(config, callbackUrl(request), new URL(request.url).searchParams, flow);
    response = NextResponse.redirect(new URL(returnTo, base), 303);
    response.cookies.set(sessionCookie, userToken(user), cookieOptions(sessionMaxAge));
  } catch (error) {
    response = signedOut(base, error);
  }
  response.cookies.set(flowCookie, "", cookieOptions(0, "/api/auth"));
  return response;
}
