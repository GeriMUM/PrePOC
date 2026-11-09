import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { contentSecurityPolicy, proxy } from "../proxy";

test("every page response gets a strict, nonce-based Content-Security-Policy", () => {
  const response = proxy(new NextRequest("http://localhost:3000/ideas"));
  const policy = response.headers.get("Content-Security-Policy") ?? "";
  const nonce = /'nonce-([A-Za-z0-9+/=]+)'/.exec(policy)?.[1];
  assert.ok(nonce && nonce.length >= 20);
  assert.match(policy, /script-src 'self' 'nonce-[^']+' 'strict-dynamic'/);
  assert.match(policy, /frame-ancestors 'none'/);
  assert.match(policy, /object-src 'none'/);
  assert.match(policy, /base-uri 'self'/);
  assert.match(policy, /form-action 'self'/);
  assert.notEqual(proxy(new NextRequest("http://localhost:3000/ideas")).headers.get("Content-Security-Policy"), policy);
});

test("production policy allows no eval and upgrades insecure requests; development allows React's debugging eval", () => {
  const production = contentSecurityPolicy("abc", false);
  assert.doesNotMatch(production, /unsafe-eval/);
  assert.match(production, /upgrade-insecure-requests/);
  assert.match(production, /connect-src 'self';/);
  const development = contentSecurityPolicy("abc", true);
  assert.match(development, /'unsafe-eval'/);
  assert.match(development, /connect-src 'self' ws: wss:/);
});
