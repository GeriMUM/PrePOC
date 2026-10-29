import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { AppError } from "../lib/errors";
import { BlobStore, storage } from "../lib/storage";

const keys = ["STORAGE_DRIVER", "BLOB_READ_WRITE_TOKEN", "BLOB_STORE_ID", "VERCEL_OIDC_TOKEN"] as const;
let original: (string | undefined)[];
beforeEach(() => {
  original = keys.map((key) => process.env[key]);
  for (const key of keys) delete process.env[key];
  process.env.STORAGE_DRIVER = "blob";
});
afterEach(() => {
  keys.forEach((key, index) => {
    if (original[index] === undefined) delete process.env[key];
    else process.env[key] = original[index];
  });
});

test("connected Blob stores accept managed OIDC without a static token", () => {
  process.env.BLOB_STORE_ID = "store_test";
  process.env.VERCEL_OIDC_TOKEN = "test-runtime-token";
  assert.ok(storage() instanceof BlobStore);
});

test("legacy static-token Blob authentication remains supported", () => {
  process.env.BLOB_READ_WRITE_TOKEN = "test-static-token";
  assert.ok(storage() instanceof BlobStore);
});

test("missing or incomplete Blob credentials fail explicitly", () => {
  const missing = () => assert.throws(storage, (error: unknown) =>
    error instanceof AppError && error.code === "STORAGE_NOT_CONFIGURED");
  missing();
  process.env.BLOB_STORE_ID = "store_test";
  missing();
  delete process.env.BLOB_STORE_ID;
  process.env.VERCEL_OIDC_TOKEN = "test-runtime-token";
  missing();
  process.env.BLOB_STORE_ID = " ";
  process.env.BLOB_READ_WRITE_TOKEN = " ";
  missing();
});
