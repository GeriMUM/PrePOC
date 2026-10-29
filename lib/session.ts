import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { AppError } from "./errors";
import { idSchema } from "./model";

const cookieName = "spark-session";
function secret() {
  const value = process.env.SESSION_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production") throw new AppError("SESSION_NOT_CONFIGURED", 503);
  return "local-development-only-not-for-deployment";
}
function signature(id: string) {
  return createHmac("sha256", secret()).update(id).digest("base64url");
}

export async function session(create = false): Promise<string> {
  const jar = await cookies();
  const value = jar.get(cookieName)?.value;
  if (value) {
    const [id, supplied, extra] = value.split(".");
    if (!extra && idSchema.safeParse(id).success && supplied) {
      const expected = Buffer.from(signature(id));
      const actual = Buffer.from(supplied);
      if (expected.length === actual.length && timingSafeEqual(expected, actual)) return id;
    }
  }
  if (!create) throw new AppError("SESSION_REQUIRED", 401);
  const id = randomUUID();
  jar.set(cookieName, `${id}.${signature(id)}`, {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365,
  });
  return id;
}
