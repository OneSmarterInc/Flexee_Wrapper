# Dependency audit

**Reviewed:** 1 October 2026 · **Tree:** `69a9368` · **Reviewer:** Vikram Sethi

`npm audit` reported six findings (five moderate, one high). This records what each one is, how it
reaches this application, why none of them is exploitable here, and what was changed. Read this before
reacting to an `npm audit` warning in this repository.

The six findings came from **two root causes**. One has been fixed; the other is being left alone
deliberately, for the reasons below.

## Summary

| Finding | Severity | Reaches us via | Runs at | Exploitable here | Action |
|---|---|---|---|---|---|
| `esbuild` ≤0.24.2 | moderate | `@esbuild-kit/core-utils` | never loaded | No | None |
| `@esbuild-kit/core-utils` | moderate | `@esbuild-kit/esm-loader` | never loaded | No | None |
| `@esbuild-kit/esm-loader` | moderate | `drizzle-kit` | never loaded | No | None |
| `drizzle-kit` 0.19.0–1.0.0-beta | moderate | **direct devDependency** | developer machines only | No | None |
| `postcss` ≤8.5.22 | **high** | `next` | build and `next dev` | No | **Fixed** by an override |
| `next` | moderate | **direct dependency** | — (flagged only for postcss) | No | Cleared by the same override |

After the change: `npm audit --omit=dev` reports **0 vulnerabilities**. `npm audit` still reports the
four dev-only esbuild findings.

## Chain 1 — esbuild, through drizzle-kit (four findings, all moderate)

**The advisory.** [GHSA-67mh-4wv8-2f99](https://github.com/advisories/GHSA-67mh-4wv8-2f99): esbuild's
development server has permissive CORS, so any website a developer visits can send requests to it and
read the responses.

**How it reaches us.** `drizzle-kit` (a devDependency, used by `npm run db:generate` and
`npm run db:migrate`) declares `@esbuild-kit/esm-loader`, which depends on `@esbuild-kit/core-utils`,
which pins `esbuild@0.18.20`. npm counts each link in that chain as its own finding, which is why one
root cause produces four warnings.

**Why it is not exploitable here.** Three independent reasons, any one of which is sufficient:

1. **The vulnerable code is never loaded.** `@esbuild-kit` appears in exactly one file under
   `node_modules/drizzle-kit`: its own `package.json`. There are no references in any of its shipped
   `.js`, `.cjs` or `.mjs` files, which call `tsx` instead. The dependency is vestigial — declared and
   installed, never imported. `esbuild@0.18.20` sits on disk and is never executed.
2. **The vulnerable feature is never used.** The advisory concerns `esbuild serve`. Nothing in this
   repository starts an esbuild dev server. drizzle-kit uses esbuild only to transpile its config.
3. **It is not in production.** `drizzle-kit` is a devDependency and is never imported from `src/`.
   Production migrations run through `scripts/migrate.ts` — "production-safe; no drizzle-kit" — which
   uses `drizzle-orm`'s migrator against the plain `drizzle/*.sql` files. `auto-init` calls that same
   script. `npm audit --omit=dev` does not list any of these four findings.

Note also that drizzle-kit resolves two esbuild copies: the vulnerable `0.18.20` under
`@esbuild-kit/core-utils`, and its own `0.25.12`, which is outside the advisory range.

**Why nothing was changed.**

- `npm audit fix --force` installs **drizzle-kit@0.18.1**, a *downgrade* from 0.31.10 across thirteen
  minor versions. It predates the current config format and `drizzle-orm ^0.45.2`, so
  `npm run db:generate` would break — and it fixes nothing that was ever running.
- Upgrading does not help. **drizzle-kit@0.31.11, the latest published version, still declares
  `@esbuild-kit/esm-loader@^2.5.5`.** The warning persists at every current version.
- An `overrides` entry could silence it, but it would change the resolved version of a package that
  nothing executes. Recording the reasoning is more honest than editing the tree.

**Revisit when** drizzle-kit drops the `@esbuild-kit` dependency in favour of the `tsx` it already
uses. Then a routine upgrade clears all four.

## Chain 2 — postcss, through Next (two findings, one high) — FIXED

**The advisories.** Four against `postcss` ≤8.5.22:

- [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93) — XSS via an unescaped
  `</style>` in stringify output
- [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q) — arbitrary file read via
  an attacker-controlled `sourceMappingURL` in a CSS comment
- [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp) — incomplete fix of the
  above, when `from` is unset
- [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849) — path traversal in
  previous-source-map auto-loading

**How it reaches us.** `next` pins `postcss` exactly, and `next@15.5.25` pinned `8.4.31`. postcss is
never imported by this application; it arrives solely as Next's internal CSS compiler.

**Where it runs.** Build time and `next dev`. This app has no `postcss.config.*` and no Tailwind. Its
CSS is two committed files, `src/app/globals.css` and `src/app/ui-polish.css`, imported by
`layout.tsx` and compiled at build into one static asset under `.next/static/css/`. On Vercel that
asset is prebuilt, so postcss does not run while serving requests.

**Why it was not exploitable here.** All four advisories require **attacker-controlled CSS input**.
No code path in this application accepts CSS from anyone: the only input postcss sees is those two
files in the repository. Book content goes through remark/rehype as HTML, which does not involve
postcss.

**It was fixed anyway**, because unlike chain 1 this one sat in *production* dependencies, carried the
only **high** severity, and the fix turned out to be cheap and verifiable.

### What was changed

`package.json` gained:

```json
"overrides": { "postcss": "^8.5.28" }
```

That is the whole change — three lines, no application code. It resolves `postcss` to **8.5.28**
(from 8.4.31), above the ≤8.5.22 advisory range, while staying on **Next 15.5.25**.

**Why an override rather than an upgrade.** Staying current on Next 15 does not fix this:
`next@15.5.27`, the latest 15.x, **still pins `postcss@8.4.31`**. The first Next release carrying a
fixed postcss is `next@16.3.8` (which pins 8.5.23) — a major upgrade, and the only remedy
`npm audit fix --force` offers.

### How it was verified

- `npm audit --omit=dev` → **`found 0 vulnerabilities`** (was 2: postcss and next).
- `npm audit` → 4, down from 6; the remainder is chain 1.
- `npx tsc --noEmit` → clean.
- `npm run build` after `rm -rf .next` → succeeded, 19/19 static pages.
- **The generated CSS is byte-identical.** Before and after produce the same single asset,
  `0dba92aff725a113.css`, 17,461 bytes, sha256 beginning `1fb7904f700533ff`; `diff` reports no
  differences. The filename is itself a content hash, so an unchanged name is independent
  corroboration that the compiled output did not move.
- All 13 test suites pass: `aol`, `meta`, `intake` 13/13, `storage` 13, `admin` 12, `publish` 14,
  `library` 13, `assignments` 22, `gradebook` 12, `gb-starter` 7, `grading` 26, `sim-grades` 16,
  `sims` 14.

## Next 16 is planned as separate work

Moving to `next@16` is the only way to get a fixed postcss from the framework itself rather than from
an override, and it brings the usual major-version benefits. It is **deliberately not part of this
change**: it is a framework major with its own migration notes, and bundling it into a security fix
would make both harder to review and harder to roll back.

It is scheduled as its own piece of work, with its own build and full test pass. When it lands, the
`postcss` override here becomes redundant and should be removed in the same commit — so that
`package.json` does not keep pinning a transitive version the framework already satisfies.

## Re-running this review

```bash
npm audit              # expect 4 moderate: the dev-only esbuild chain
npm audit --omit=dev   # expect 0
```

If `npm audit --omit=dev` ever reports anything, it is new and wants investigating. If the four
dev-only findings change in number or package, check whether drizzle-kit has finally dropped
`@esbuild-kit` — and if so, upgrade it and delete chain 1 from this document.
