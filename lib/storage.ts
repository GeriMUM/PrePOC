import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BlobPreconditionFailedError,
  get, list, put,
} from "@vercel/blob";
import { AppError } from "./errors";

export interface StoredFile { text: string; version: string }
export interface JsonStore {
  read(key: string): Promise<StoredFile | null>;
  write(key: string, text: string, version?: string): Promise<string>;
  keys(prefix: string): Promise<string[]>;
}

const locks = new Map<string, Promise<void>>();
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

export class FileStore implements JsonStore {
  constructor(private root: string) {}

  private resolve(key: string) {
    if (!/^(ideas|comments)\/[a-zA-Z0-9/-]*(?:\.json)?$/.test(key) || key.includes("..")) {
      throw new Error("Invalid storage key");
    }
    return path.join(this.root, ...key.split("/"));
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

  async write(key: string, text: string, version?: string): Promise<string> {
    const target = this.resolve(key);
    const previous = locks.get(target) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    locks.set(target, current);
    await previous;
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
      release();
      if (locks.get(target) === current) locks.delete(target);
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

export class BlobStore implements JsonStore {
  async read(key: string): Promise<StoredFile | null> {
    const result = await get(key, { access: "private", useCache: false });
    if (!result) return null;
    if (result.statusCode !== 200) throw new Error("Unexpected Blob response");
    return { text: await new Response(result.stream).text(), version: result.blob.etag };
  }

  async write(key: string, text: string, version?: string): Promise<string> {
    try {
      const result = await put(key, text, {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        allowOverwrite: version !== undefined,
        ...(version !== undefined ? { ifMatch: version } : {}),
      });
      return result.etag;
    } catch (error) {
      if (error instanceof BlobPreconditionFailedError) {
        throw new AppError("CONFLICT", 409);
      }
      throw error;
    }
  }

  async keys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      keys.push(...page.blobs.map((blob) => blob.pathname));
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return keys;
  }
}

export function storage(): JsonStore {
  const driver = process.env.STORAGE_DRIVER ?? (process.env.NODE_ENV === "production" ? "blob" : "file");
  if (driver === "blob") {
    if (!process.env.BLOB_READ_WRITE_TOKEN) throw new AppError("STORAGE_NOT_CONFIGURED", 503);
    return new BlobStore();
  }
  if (driver === "file" && !process.env.VERCEL) return new FileStore(path.join(process.cwd(), ".data"));
  throw new AppError("STORAGE_NOT_CONFIGURED", 503);
}
