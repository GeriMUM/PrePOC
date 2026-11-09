import { callbackUrl, devLoginAllowed, devUser, entraConfig, flowCookie, flowMaxAge, origin, safeReturnTo, startLogin } from "../../../../lib/auth";
import { redirectTo, signedOut } from "../../../../lib/auth-response";
import { AppError } from "../../../../lib/errors";
import { cookieOptions, sessionCookie, sessionMaxAge, userToken } from "../../../../lib/session";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const base = origin(request);
  const returnTo = safeReturnTo(new URL(request.url).searchParams.get("returnTo"));
  try {
    const config = entraConfig();
    if (!config) {
      if (!devLoginAllowed()) throw new AppError("AUTH_NOT_CONFIGURED", 503);
      const response = redirectTo(new URL(returnTo, base), 307);
      response.cookies.set(sessionCookie, userToken(devUser), cookieOptions(sessionMaxAge));
      return response;
    }
    const { url, flow } = startLogin(config, callbackUrl(request), returnTo);
    const response = redirectTo(url, 307);
    response.cookies.set(flowCookie, flow, cookieOptions(flowMaxAge, "/api/auth"));
    return response;
  } catch (error) {
    return signedOut(base, error);
  }
}
