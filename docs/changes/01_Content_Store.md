# Wrapper change 1 — Content store (books from a folder or from S3)

**For:** Akshay · **From:** Vikram · **27 September 2026** · Patch: `0001-content-store-s3.patch`

## Why this change

We are moving to: **Vercel + Supabase for testing, AWS for production**, with books kept in
**Amazon S3** in both, loaded through an upload page in the admin area. This is step 1: the app
can now read books either from its own `content/` folder (as today) or from an S3 bucket, chosen
by a setting. Nothing else in the app knows or cares where books live.

It also fixes a **security problem** in the current live site — see below. Please apply this first.

## Security fix — deploy this now

The old figure route (`/api/asset/...`) served **any** file under `content/` to anyone, without
login. That includes the answer key. On the current test site, this address returns every MIS 3000
question with its correct answer marked:

    /api/asset/mis3000/questions.json

After this patch the figure route serves image files only (`.png .jpg .jpeg .gif .svg .webp`) and
returns 404 for everything else. The build also no longer bundles `questions.json` into the app at
all — the app never reads it; only `npm run db:sync-questions` does, from the repository.

## What changed (8 files)

| File | Change |
|---|---|
| `src/lib/storage.ts` | **New.** `ContentStore` with two implementations — `FsStore` (the `content/` folder) and `S3Store` (a bucket) — plus a short in-memory cache and `storeFromEnv()` to pick one from settings |
| `src/lib/content.ts` | Reads manifests and chapter text through the store instead of `fs`. Same exported functions and return values, except `getEntry` returns `key` instead of the unused disk path `dir`. `listBooks` ignores `_archive`/`_staging` |
| `src/app/api/asset/[...path]/route.ts` | Reads figures through the store; **images only** |
| `next.config.mjs` | Your webpack alias kept. Adds an explicit rule that bundles `content/` (so a future change cannot silently drop it) and excludes the answer key and intake bookkeeping |
| `src/db/index.ts` | Restores `DB_POOL_MAX` (connections per serverless instance) |
| `package.json` | Adds `@aws-sdk/client-s3`, dev `aws-sdk-client-mock`, and `npm run test:storage` |
| `.env.example` | Documents the new settings |
| `scripts/it-storage.ts` | **New** integration test |

## Apply

```
git am 0001-content-store-s3.patch
npm install
npm run test:storage
```

Expected: `11 passed`. The test copies the real `content/` tree into a mocked S3 bucket and checks
that **both books, all 39 chapters and front-matter pages, their tables of contents, text and
figure lists read identically** from disk and from S3; that the figure route serves a figure from
S3, refuses `questions.json` and manifests, refuses path traversal, and returns 404 for a missing
figure.

Then build and deploy as usual. **With no new settings, the app behaves exactly as today**
(`CONTENT_STORE` defaults to `fs`).

## Settings (for later, when the S3 bucket exists)

| Variable | Test (Vercel) | Production (AWS) |
|---|---|---|
| `CONTENT_STORE` | `s3` | `s3` |
| `CONTENT_BUCKET` | `flexee-books-test` | `flexee-books-prod` |
| `CONTENT_PREFIX` | `live/` | `live/` |
| `AWS_REGION` | `us-east-2` | `us-east-2` |
| AWS credentials | `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` of an IAM user with **read-only** access to the test bucket | none — use the Amplify app's IAM role |
| `CONTENT_CACHE_SECONDS` | `300` | `300` |
| `DB_POOL_MAX` | `3` | `3` |

Don't switch to `s3` yet: the bucket and the upload/intake step come next (change 2). Until then,
keep `fs`.

## What comes next

- **Change 2 — intake service and admin upload.** Admin uploads a book folder as a zip (downloaded
  from Drive with one click), the intake runs, the report shows on screen, Approve publishes the book
  to S3 and loads its questions. Replaces the Git-commit route.
- **Change 3 — AWS production.** Amplify Hosting, RDS for Postgres, the S3 buckets.
