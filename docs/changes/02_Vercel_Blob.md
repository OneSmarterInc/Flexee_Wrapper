# Wrapper change 2 — Vercel Blob as a content store

**For:** Akshay · **From:** Vikram · **27 September 2026** · Patch: `0002-content-store-vercel-blob.patch`
**Apply after** `0001-content-store-s3.patch` (see `Wrapper_Change1_Content_Store.md`).

## Decision

For now, books will be kept in **Vercel Blob**, not S3. The storage layer from change 1 now has
three stores behind one interface, chosen by `CONTENT_STORE`:

| `CONTENT_STORE` | Where books live | Use |
|---|---|---|
| `fs` (default) | the `content/` folder shipped with the app | local development; today's behaviour |
| `blob` | **Vercel Blob, private** | test and production for now |
| `s3` | an S3 bucket | kept for a later move to AWS — no code change needed then |

Books are stored as **private** blobs: they can only be read with the store's token, which stays on
the server. The app streams chapters and figures to logged-in pages through its own routes; no
blob URL is ever handed to a browser.

## Apply

```
git am 0001-content-store-s3.patch        # if not applied yet
git am 0002-content-store-vercel-blob.patch
npm install
npm run test:storage
```

Expected: `13 passed`. Both books (39 chapters and front-matter pages) read identically from disk,
from S3 and from a simulated private Blob store; every Blob read uses private access; a figure is
served from Blob through the figure route; the answer key and manifests are refused.

## Setting up the Blob store (Vercel dashboard)

1. **Storage → Create → Blob**, name it `flexee-books`, and **connect it to the Wrapper project**.
   Vercel adds `BLOB_READ_WRITE_TOKEN` to the project's environment automatically.
2. Do **not** switch `CONTENT_STORE` to `blob` yet. The store starts empty; books get into it through
   the upload page (change 3). Until then keep `CONTENT_STORE=fs` (or unset).

When change 3 is in, the settings will be:

| Variable | Value |
|---|---|
| `CONTENT_STORE` | `blob` |
| `CONTENT_PREFIX` | `live/` |
| `CONTENT_BLOB_ACCESS` | `private` |
| `BLOB_READ_WRITE_TOKEN` | set by Vercel |
| `CONTENT_CACHE_SECONDS` | `300` |
| `DB_POOL_MAX` | `3` |

## Next — change 3: uploading books in the app

An **Upload book** page for admins and faculty: upload a book folder as a zip (Drive → right-click
the book's `CURRENT` folder → Download), the intake runs and its report shows on screen, and
**Publish** copies the approved book into Blob under `live/` and loads its objectives and questions
into the database. This replaces the Git-commit route and the local-intake runbook.
