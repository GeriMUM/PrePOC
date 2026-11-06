import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { AppError } from "./errors";
import { sign, verify } from "./tokens";

export interface User { id: string; name: string }

export const sessionCookie = "cc-user";
export const sessionMaxAge = 60 * 60 * 24 * 7;
const userSchema = z.object({ id: z.string().min(1).max(128), name: z.string().min(1).max(80), exp: z.number() });

export function userToken(user: User, now = Date.now()) {
  return sign("user", { id: user.id, name: user.name, exp: Math.floor(now / 1000) + sessionMaxAge });
}

export function userFromToken(token: string | undefined, now = Date.now()): User | null {
  const parsed = userSchema.safeParse(verify("user", token));
  if (!parsed.success || parsed.data.exp <= now / 1000) return null;
  return { id: parsed.data.id, name: parsed.data.name };
}

export const cookieOptions = (maxAge: number, path = "/") => ({
  httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path, maxAge,
});

export async function currentUser(): Promise<User | null> {
  return userFromToken((await cookies()).get(sessionCookie)?.value);
}

/** For API routes: the signed-in user, or HTTP 401. */
export async function session(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new AppError("SESSION_REQUIRED", 401);
  return user;
}

/** For pages: the signed-in user, or a redirect into the login flow. */
export async function requireUser(returnTo: string): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  return user;
}
