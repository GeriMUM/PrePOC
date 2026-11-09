# copilot & coffee - The idea lab

A small, bilingual AI hackathon submission platform. One Next.js application,
two main pages, JSON files, no database, and Microsoft Entra ID sign-in.

## What is included

- **Idea workshop (`/`):** a Google Gemini chat beside an editable idea summary.
  Employees review and apply suggested titles and descriptions; no technical
  architecture answers are required.
- Everything requires signing in with a company Microsoft account. The author
  name on ideas and comments comes from that sign-in and cannot be typed or changed.
- Save incomplete drafts at any time; they belong to your account, on any device.
  Publishing requires only a title and problem description.
  The submission form contains only these fields and the event selector; there
  is no optional-details section. Existing additional details remain preserved
  in saved records.
- **Gallery (`/ideas`):** published ideas, event filtering, text search, idea
  details, and comments.
- English/German interface switching, remembered with a cookie.
- Events: `copilot&coffe vol 1` and `copilot & coffe vol 2`.
- Private Vercel Blob JSON storage in deployment; local JSON files for development.

No sample submissions are inserted into real storage. Published ideas are
read-only in this MVP. Comments cannot be edited or deleted through the UI.
Interface switching does not translate employees' submitted content.
Page navigation uses full document loads so the browser can warn about unsaved
draft changes before leaving the workshop.

## Run locally

Requires Node.js 22+ and npm.

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Copy the example only when creating a new environment file; do not overwrite
existing storage/session settings or credentials.
Open `http://localhost:3000`. Development defaults to JSON files in `.data`,
which is ignored by Git. No AI, storage, or Entra credentials are needed to try the
forms, persistence, publishing, and comments locally: with `DEV_LOGIN=1` and no
`ENTRA_*` variables, development signs you in as a fixed "Local Developer" test
user. This opt-in is ignored in production builds and on Vercel. The dev server
listens on `127.0.0.1` only, and without `SESSION_SECRET` it signs sessions with
a random key per process.

```powershell
npm run typecheck
npm run lint
npm test
npm run build
```

For a local production build, set `STORAGE_DRIVER=file` and a random
`SESSION_SECRET` of at least 32 characters in `.env.local`, then run
`npm run build` and `npm start`. File mode is intentionally rejected on Vercel.

## Deploy an HTTPS website on Vercel

1. Push this application to your GitHub repository and import it into Vercel.
   Use the detected **Next.js** preset and Node.js 22 or newer.
   The repository's `vercel.json` explicitly selects Next.js and automatic
   output detection. Leave the Output Directory override disabled; do not use
   `public` or configure this application as a static website. If deployment
   reports `STATIC_BUILD_NO_OUT_DIR`, check these project settings and redeploy
   the latest commit.
2. In Vercel Storage, create a **private** Blob store and connect it to the
   project for Production. Vercel adds `BLOB_STORE_ID` and supplies a rotating
   OIDC credentials at runtime, including through the request context rather than
   necessarily `process.env`; the Blob SDK handles authentication and refresh.
   Do not copy or manually set the OIDC token.
   A public store is not suitable for drafts.
3. Add environment variables:

   | Variable | Value |
   | --- | --- |
   | `STORAGE_DRIVER` | `blob` |
   | `BLOB_STORE_ID` | Added by the connected private Blob store |
   | `BLOB_READ_WRITE_TOKEN` | Optional alternative for static-token authentication, e.g. outside Vercel |
   | `SESSION_SECRET` | A randomly generated secret, at least 32 characters |
   | `ENTRA_TENANT_ID` | Directory (tenant) ID of the company Entra tenant |
   | `ENTRA_CLIENT_ID` | Application (client) ID of the app registration |
   | `ENTRA_CLIENT_SECRET` | Client secret value of the app registration |
   | `GEMINI_API_KEY` | Server-only Gemini API key from Google AI Studio |
   | `GEMINI_MODEL` | `gemini-3.1-flash-lite` (default) |

   Generate a session secret with:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

4. Deploy or redeploy after configuring environment variables. Vercel gives the
   website an HTTPS address. Do not commit credentials.
5. At that address, save and reopen a draft, publish an idea, filter its event,
   post a comment, and verify another account cannot list or modify the draft.

Use **separate Blob stores and session secrets for Preview and Production**,
so preview deployments cannot modify production submissions.
Vercel plan availability and Blob usage charges apply. Hobby hosting is limited
to personal, non-commercial use; a company deployment must use an appropriate
hosting plan. Gemini free quota is separate from hosting and storage costs.

### Data layout and simultaneous changes

```text
ideas/<idea-uuid>.json
comments/<idea-uuid>/<comment-uuid>.json
usage/<yyyy-mm-dd>/<bucket>/<hash>.json   (daily counters for the limits below)
```

All files are private. Only backend routes read or write them; browser clients
never receive a storage token or raw Blob URL. Public gallery responses omit
drafts, internal ownership identifiers and the storage version of published
ideas. Likes are stored as keyed hashes of idea and account (`lib/ideas.ts`), so
neither the files nor any response names who liked.

### Limits

Per account and day: 300 saves, comments and likes together, and 80 coach
messages (1,500 for everyone). Per account: 25 drafts and 10 published ideas;
2,000 idea files in total; 500 comments per idea and 30 per account and idea;
5,000 likes per idea. Exceeding a limit answers HTTP 429 with a fixed error code.
Counters are small files under `usage/` (one per account, bucket and day, keyed
by a hash of the account id); they are not cleaned up automatically.

Each idea is a single small JSON document. Updates use the Blob ETag with
`ifMatch` (optimistic concurrency). A stale writer receives HTTP 409 instead of
silently replacing another update. Private reads bypass Blob's content cache.
Comments each have their own immutable file, so simultaneous comments do not
overwrite one another. Listing is paginated internally.

The local adapter uses atomic file replacement and per-file serialization.
It is for one Node.js process on a persistent disk, not a multi-process shared
filesystem. Switching between local files and Blob does **not** migrate data.

This design deliberately lists and reads ideas on each request. It is suitable
for the stated tiny dataset, not a large/high-traffic platform. Export private
JSON files regularly according to company retention and backup requirements.

## Connect Gemini's free tier

1. Create an API key in [Google AI Studio](https://aistudio.google.com/apikey)
   using a project eligible for the Gemini API free tier. To avoid paid token
   usage, use a project without an active billing account; do not enable billing
   or assume a budget alert is a hard spending cap.
2. Add `GEMINI_API_KEY=your-key` to ignored `.env.local`, or the
   server's deployment environment. Never put it in a `NEXT_PUBLIC_` variable,
   source code, or a chat message.
   The previous name `GOOGLE_GENERATIVE_AI_API_KEY` is also supported.
   If both are nonempty, `GEMINI_API_KEY` takes precedence.
3. Optionally set `GEMINI_MODEL=gemini-3.1-flash-lite`. This is the default
   lightweight model. Check current availability and free quota in AI Studio.
   The default uses `thinkingLevel=minimal`; legacy Gemini 2.5 Flash models use
   `thinkingBudget=0`. Other configured models use their default thinking settings.
4. Restart the development server or redeploy. The workshop uses its own chat,
   not a Microsoft iframe.
5. Test English and German, a follow-up question, a suggested summary, applying
   it, saving a draft, and publishing. The model never saves or publishes.

The browser calls same-origin `POST /api/chat`; only the server calls Google's
REST API. No AI SDK, Vercel Gateway account, extra service, or database is needed.
The key is sent to Google in a header and never returned to the browser.
There are no placeholder AI responses or automatic paid-model fallbacks.
Without a key, chat is visibly disabled; drafting and publishing remain usable.

Each request sends the selected language, current title and problem description,
and up to 11 alternating chat messages (10,000 characters total). Older turn
pairs are dropped to bound usage, so the model may forget earlier details.
Display name, event, cookie, and stored ownership metadata are not forwarded.
Do not type identifying information into messages or descriptions either.
Responses are limited to 800 output tokens with a 45-second provider timeout;
truncated, blocked, malformed, and failed responses produce explicit errors.
Failed sends preserve the input and do not enter the successful conversation.
There are no automatic retries.
Setup failures distinguish rejected keys, disabled API access, missing models,
permission failures, and rejected request parameters. Only fixed error codes
are returned or logged, never raw Google error messages or credential metadata.

The endpoint requires a signed-in user and same-origin JSON.
An in-memory per-user cooldown allows at most one attempt per 10 seconds, and
durable daily budgets in the store cap coach messages per account (80) and for
everyone (1,500); see Limits above. Also set a quota or budget cap on the Google
side before wider rollout.

Google's free quota and rate limits vary by model, project, and availability.
When quota is exhausted, chat reports it instead of silently switching providers.
Free usage is not unlimited or guaranteed. Hosting and storage remain separate.
Review company approval, Google's terms and regional data handling before using
real ideas. Google's unpaid-service data-use terms include an EEA/UK/Switzerland
exception; free access alone does not establish suitability for confidential data.

Chat transcripts remain in the open page only, not in application storage.
Refreshing or changing ideas resets the chat; saving the same draft does not.
Google may process or retain requests under its own applicable terms.

### Structured summary contract

The server instructs Gemini to include a fenced `idea-summary` block when useful,
in addition to its normal conversational response:

````text
Here is a starting point. Who would you test this with?
```idea-summary
{
  "title": "Time booking without the busywork",
  "problem": "Preparing entries takes too much effort. An agent could suggest entries for the employee to review."
}
```
````

The coach is asked to suggest only `title` and `problem`, the visible text fields.
The shared parser also supports legacy `audience`, `solution`, `approach`, `impact`.
All values must be strings within the form's length limits. Unknown requirements
should be omitted, not invented. The UI validates the object and offers **Use
these suggestions**. Applying it changes only nonempty summary fields, never
the author, event, ownership, or publication status. Saving and publishing still
require explicit employee actions. Invalid summaries cannot be applied.

References:
[Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing),
[Gemini terms](https://ai.google.dev/gemini-api/terms),
[Gemini REST API](https://ai.google.dev/api/generate-content),
[Vercel Blob SDK](https://vercel.com/docs/vercel-blob/using-blob-sdk).

## Microsoft Entra sign-in

Sign-in is a single-tenant OpenID Connect authorization code flow with PKCE,
implemented in `lib/auth.ts` without extra packages. Only accounts of the
configured tenant can sign in. The app requests only `openid profile` (name and
account ID), which needs no admin consent.

1. In the [Entra admin center](https://entra.microsoft.com) open **App registrations →
   New registration**. If you may not register apps, ask an Entra admin to do these steps.
   - Supported account types: **Accounts in this organizational directory only**.
   - Redirect URI: platform **Web**,
     `https://<your-project>.vercel.app/api/auth/callback`.
2. To test the real sign-in locally, create a separate development app
   registration with `http://localhost:3000/api/auth/callback` as its Web redirect
   URI; keep the production registration limited to the production URL.
3. Under **Certificates & secrets**, create a client secret and copy its **Value**
   (not its ID). Note its expiry date: sign-in stops when it expires.
4. From **Overview**, copy the Directory (tenant) ID and Application (client) ID.
5. Set `ENTRA_TENANT_ID`, `ENTRA_CLIENT_ID`, and `ENTRA_CLIENT_SECRET` in Vercel
   (Production scope only), then redeploy. Never commit them, and never copy the
   production secret into `.env.local`. Local sign-in also needs `SESSION_SECRET`.
6. Optional: to limit access to specific people, enable **Assignment required** on
   the app's Enterprise application entry and assign users or groups.

Each additional domain (for example a custom domain) needs its own redirect URI.
Preview deployments get changing URLs, so sign-in is meant for Production and
localhost.

### What this protects

- Every page and API route requires a signed-in user. Unauthenticated page
  visits are redirected to Microsoft; API calls get HTTP 401.
- The author name of ideas and comments is set by the server from the sign-in.
  Requests that try to supply an author are rejected.
- Drafts belong to the Entra account (`oid`), not to a browser.
- Comments store the author's account ID internally (not returned to browsers),
  so misuse can be traced to an account.
- The session is a signed (HMAC-SHA256), HttpOnly, SameSite=Lax cookie valid for
  twelve hours; it cannot be revoked earlier. Changing `SESSION_SECRET` signs
  everyone out.
- Likes are keyed hashes of idea and account, and published ideas carry no
  storage version, so neither the files nor API responses reveal who liked.
- Sign-in always shows Microsoft's account picker (`prompt=select_account`), and
  each login attempt can be completed only once.
- Every page carries a nonce-based Content-Security-Policy (`proxy.ts`); all
  responses carry HSTS, Permissions-Policy and X-Frame-Options, and sign-in
  responses are never cached.
- Daily per-account limits (see Limits) bound what one account can create or spend.
- The ID token is received directly from Entra's token endpoint over TLS in
  exchange for the client secret; its audience, issuer, tenant, nonce, and
  expiry are checked (OpenID Connect Core 1.0, section 3.1.3.7).

"Sign out" ends the session on this website only, not the Microsoft session;
"Sign in" afterwards shows the account picker, so on a shared computer the next
person does not silently continue as the previous one.
Ideas and comments created before sign-in was introduced keep their old,
self-declared names and have no real owner (no "Your idea" badge, no own-like
block); old anonymous drafts are no longer reachable. Remove such legacy records
from the store if that matters.

Before entering confidential information, check company approval, retention, and
moderation needs. There is no admin role yet to hide ideas or comments.

## Verification boundaries

Automated tests cover local persistence, draft isolation, publishing,
validation/length limits, concurrent update conflicts, concurrent comments,
storage path validation, bilingual message coverage, Gemini request/response
handling and quota errors, sign-in validation and session tokens, and summary validation.
Live private Blob operations, real Gemini responses, the real Microsoft sign-in, and public
HTTPS deployment must be smoke-tested with your organization's accounts and configuration.
