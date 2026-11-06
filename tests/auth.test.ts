import assert from "node:assert/strict";
import { test } from "node:test";
import { devLoginAllowed, entraConfig, finishLogin, safeReturnTo, startLogin, type EntraConfig } from "../lib/auth";
import { AppError } from "../lib/errors";
import { userFromToken, userToken } from "../lib/session";
import { sign } from "../lib/tokens";

const config: EntraConfig = {
  tenantId: "11111111-2222-3333-4444-555555555555",
  clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
  clientSecret: "test-secret",
};
const redirectUri = "http://localhost:3000/api/auth/callback";
const oid = "99999999-8888-7777-6666-555555555555";
const hasCode = (code: string) => (error: unknown) => error instanceof AppError && error.code === code;

function idToken(claims: Record<string, unknown>) {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

function login(overrides: Record<string, unknown> = {}) {
  const { url, flow } = startLogin(config, redirectUri, "/ideas");
  const authorize = new URL(url);
  const claims = {
    aud: config.clientId, iss: `https://login.microsoftonline.com/${config.tenantId}/v2.0`, tid: config.tenantId,
    oid, nonce: authorize.searchParams.get("nonce"), exp: Math.floor(Date.now() / 1000) + 3600, name: "Alex Example",
    ...overrides,
  };
  const requests: { url: string; body: URLSearchParams }[] = [];
  const fetcher = (async (input: string, init: RequestInit) => {
    requests.push({ url: input, body: init.body as URLSearchParams });
    return Response.json({ id_token: idToken(claims) });
  }) as unknown as typeof fetch;
  const params = new URLSearchParams({ code: "auth-code", state: authorize.searchParams.get("state") ?? "" });
  return { authorize, flow, params, fetcher, requests };
}

test("Entra configuration requires a tenant GUID, client GUID, and secret; absent means not configured", () => {
  assert.equal(entraConfig({}), null);
  assert.deepEqual(entraConfig({ ENTRA_TENANT_ID: config.tenantId, ENTRA_CLIENT_ID: config.clientId, ENTRA_CLIENT_SECRET: "s" }),
    { ...config, clientSecret: "s" });
  for (const env of [
    { ENTRA_TENANT_ID: "common", ENTRA_CLIENT_ID: config.clientId, ENTRA_CLIENT_SECRET: "s" },
    { ENTRA_TENANT_ID: config.tenantId, ENTRA_CLIENT_ID: config.clientId },
    { ENTRA_CLIENT_SECRET: "s" },
  ]) assert.throws(() => entraConfig(env), hasCode("AUTH_INVALID_CONFIG"));
});

test("the local test login is never available in production or on Vercel", () => {
  assert.equal(devLoginAllowed({ NODE_ENV: "development" }), true);
  assert.equal(devLoginAllowed({ NODE_ENV: "production" }), false);
  assert.equal(devLoginAllowed({ NODE_ENV: "development", VERCEL: "1" }), false);
});

test("return paths stay on this site", () => {
  assert.equal(safeReturnTo("/ideas"), "/ideas");
  for (const bad of ["//evil.example", "https://evil.example", "/\\evil.example", "ideas", null]) assert.equal(safeReturnTo(bad), "/");
});

test("sign-in uses the tenant authority with PKCE and returns the verified user", async () => {
  const { authorize, flow, params, fetcher, requests } = login();
  assert.equal(authorize.origin + authorize.pathname, `https://login.microsoftonline.com/${config.tenantId}/oauth2/v2.0/authorize`);
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authorize.searchParams.get("redirect_uri"), redirectUri);
  const result = await finishLogin(config, redirectUri, params, flow, fetcher);
  assert.deepEqual(result, { user: { id: oid, name: "Alex Example" }, returnTo: "/ideas" });
  assert.equal(requests[0].body.get("code_verifier")?.length, 43);
  assert.equal(requests[0].body.get("client_secret"), config.clientSecret);
});

test("sign-in rejects tampered state, missing flow, and tokens for another app, tenant, or attempt", async () => {
  const valid = login();
  await assert.rejects(finishLogin(config, redirectUri, new URLSearchParams({ code: "c", state: "forged" }), valid.flow, valid.fetcher), hasCode("AUTH_FAILED"));
  await assert.rejects(finishLogin(config, redirectUri, valid.params, undefined, valid.fetcher), hasCode("AUTH_FLOW_EXPIRED"));
  await assert.rejects(finishLogin(config, redirectUri, valid.params, sign("user", {}), valid.fetcher), hasCode("AUTH_FLOW_EXPIRED"));
  for (const override of [
    { aud: "00000000-0000-0000-0000-000000000000" },
    { tid: "00000000-0000-0000-0000-000000000000" },
    { iss: "https://login.microsoftonline.com/00000000-0000-0000-0000-000000000000/v2.0" },
    { nonce: "replayed" },
    { exp: 1 },
    { name: undefined },
  ]) {
    const attempt = login(override);
    await assert.rejects(finishLogin(config, redirectUri, attempt.params, attempt.flow, attempt.fetcher), hasCode("AUTH_FAILED"));
  }
  const denied = login();
  denied.params.set("error", "access_denied");
  await assert.rejects(finishLogin(config, redirectUri, denied.params, denied.flow, denied.fetcher), hasCode("AUTH_DENIED"));
});

test("session tokens cannot be forged, edited, reused as another token type, or used after expiry", () => {
  const token = userToken({ id: oid, name: "Alex Example" });
  assert.deepEqual(userFromToken(token), { id: oid, name: "Alex Example" });
  const [data, mac] = token.split(".");
  const edited = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(data, "base64url").toString()), name: "Boss" })).toString("base64url");
  assert.equal(userFromToken(`${edited}.${mac}`), null);
  assert.equal(userFromToken(sign("flow", { id: oid, name: "Alex", exp: 9e9 })), null);
  assert.equal(userFromToken(token, Date.now() + 8 * 24 * 3600 * 1000), null);
  assert.equal(userFromToken(undefined), null);
});
