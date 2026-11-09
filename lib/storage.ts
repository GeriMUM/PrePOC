import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BlobPreconditionFailedError, BlobServiceNotAvailable, BlobServiceRateLimited,
  del, get, list, put,
} from "@vercel/blob";
import { AppError } from "./errors";

export interface StoredFile { text: string; version: string }
export interface JsonStore {
  read(key: string): Promise<StoredFile | null>;
  write(key: string, text: string, version?: string): Promise<string>;
  keys(prefix: string): Promise<string[]>;
  /** Removes one or several files; a missing file is not an error. */
  delete(key: string | string[]): Promise<void>;
}

const locks = new Map<string, Promise<void>>();
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

/** Every store only ever touches these prefixes, with ids made of hex digits and dashes. */
export function validKey(key: string): string {
  if (!/^(ideas|comments|usage)\/[a-zA-Z0-9/-]*(?:\.json)?$/.test(key) || key.includes("..")) {
    throw new Error("Invalid storage key");
  }
  return key;
}

/** Reads many keys with bounded concurrency, so a large store does not open hundreds of connections at once. */
export async function readAll(store: JsonStore, keys: string[], concurrency = 16): Promise<(StoredFile | null)[]> {
  const files: (StoredFile | null)[] = new Array(keys.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, keys.length) }, async () => {
    while (next < keys.length) {
      const index = next++;
      files[index] = await store.read(keys[index]);
    }
  }));
  return files;
}

export class FileStore implements JsonStore {
  constructor(private root: string) {}

  private resolve(key: string) {
    return path.join(this.root, ...validKey(key).split("/"));
  }

  async read(key: string): Promise<StoredFile | null> {
    try {
      const text = await readFile(this.resolve(key), "utf8");
      return { text, version: digest(text) };
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  }

  /** Serialises writes and deletes per file, so a delete cannot slip between another writer's check and its rename. */
  private async locked<T>(target: string, run: () => Promise<T>): Promise<T> {
    const previous = locks.get(target) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    locks.set(target, current);
    await previous;
    try {
      return await run();
    } finally {
      release();
      if (locks.get(target) === current) locks.delete(target);
    }
  }

  async write(key: string, text: string, version?: string): Promise<string> {
    const target = this.resolve(key);
    return this.locked(target, async () => {
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        const existing = await this.read(key);
        if (existing ? existing.version !== version : version !== undefined) {
          throw new AppError("CONFLICT", 409);
        }
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(temporary, text, { flag: "wx" });
        await rename(temporary, target);
        return digest(text);
      } finally {
        try { await unlink(temporary); } catch (error) { if (!isMissing(error)) console.error("Temporary file cleanup failed", error); }
      }
    });
  }

  async delete(key: string | string[]): Promise<void> {
    for (const target of (Array.isArray(key) ? key : [key]).map((entry) => this.resolve(entry))) {
      await this.locked(target, async () => {
        try {
          await unlink(target);
        } catch (error) {
          if (!isMissing(error)) throw error;
        }
      });
    }
  }

  async keys(prefix: string): Promise<string[]> {
    const directory = this.resolve(prefix);
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      return entries.filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => `${prefix}${entry.name}`);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/** Blob throttling or outages become a retryable 503 instead of a generic server error. */
function translate(error: unknown): never {
  if (error instanceof BlobPreconditionFailedError) throw new AppError("CONFLICT", 409);
  if (error instanceof BlobServiceRateLimited || error instanceof BlobServiceNotAvailable) throw new AppError("STORAGE_BUSY", 503);
  throw error;
}

export class BlobStore implements JsonStore {
  async read(key: string): Promise<StoredFile | null> {
    try {
      const result = await get(validKey(key), { access: "private", useCache: false });
      if (!result) return null;
      if (result.statusCode !== 200) throw new Error("Unexpected Blob response");
      return { text: await new Response(result.stream).text(), version: result.blob.etag };
    } catch (error) {
      translate(error);
    }
  }

  async write(key: string, text: string, version?: string): Promise<string> {
    try {
      const result = await put(validKey(key), text, {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: version !== undefined,
        ...(version !== undefined ? { ifMatch: version } : {}),
      });
      return result.etag;
    } catch (error) {
      translate(error);
    }
  }

  async delete(key: string | string[]): Promise<void> {
    const keys = (Array.isArray(key) ? key : [key]).map(validKey);
    try {
      // One request per batch instead of one per file, so a long conversation is removed within the function's time.
      for (let start = 0; start < keys.length; start += 100) await del(keys.slice(start, start + 100));
    } catch (error) {
      translate(error);
    }
  }

  async keys(prefix: string): Promise<string[]> {
    validKey(prefix);
    const keys: string[] = [];
    let cursor: string | undefined;
    try {
      do {
        const page = await list({ prefix, cursor, limit: 1000 });
        keys.push(...page.blobs.map((blob) => blob.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    } catch (error) {
      translate(error);
    }
    return keys;
  }
}

export function storage(): JsonStore {
  const driver = process.env.STORAGE_DRIVER ?? (process.env.NODE_ENV === "production" ? "blob" : "file");
  if (driver === "blob") {
    const hasToken = Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
    // The SDK resolves rotating OIDC credentials from Vercel's request context.
    const hasStore = Boolean(process.env.BLOB_STORE_ID?.trim());
    if (!hasToken && !hasStore) throw new AppError("STORAGE_NOT_CONFIGURED", 503);
    return new BlobStore();
  }
  if (driver === "file" && !process.env.VERCEL) return new FileStore(path.join(process.cwd(), ".data"));
  throw new AppError("STORAGE_NOT_CONFIGURED", 503);
}
