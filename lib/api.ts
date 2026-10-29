import { NextResponse } from "next/server";
import { AppError } from "./errors";

export async function api(run: () => Promise<unknown>) {
  try {
    return NextResponse.json(await run(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AppError) {
      if (error.status >= 500) console.error("Application configuration error:", error.code);
      return NextResponse.json({ error: error.code }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("Request failed", error);
    return NextResponse.json({ error: "SERVER_ERROR" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

export async function body(request: Request, maxBytes = 32_000): Promise<unknown> {
  const origin = request.headers.get("origin");
  const expectedOrigin = `${new URL(request.url).protocol}//${request.headers.get("host") ?? new URL(request.url).host}`;
  if (!origin || origin !== expectedOrigin) throw new AppError("INVALID_ORIGIN", 403);
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AppError("INVALID_INPUT");
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("INVALID_INPUT");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        throw new AppError("TOO_LARGE", 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    if (error instanceof SyntaxError) throw new AppError("INVALID_INPUT");
    throw error;
  } finally {
    reader.releaseLock();
  }
}
