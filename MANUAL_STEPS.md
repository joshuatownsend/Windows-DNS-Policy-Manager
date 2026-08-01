# Manual Steps

Steps that must be performed by hand, outside of code changes. Append only.

---

## 2026-07-30 13:05 | node-24-lts | Verify the Node 24 Docker base image

The `dns-manager/Dockerfile` base image moved from `node:22-alpine` to `node:24-alpine` (all three
stages). This could **not** be verified locally — Docker Desktop was not running — and it is **not**
covered by pull-request CI, because `.github/workflows/release-ghcr.yml` triggers only on `v*.*.*`
tags. The `node:24-alpine` tag itself was confirmed to exist on Docker Hub (last updated 2026-06-24).

- [ ] Start Docker Desktop, then build the image to confirm the base bump is sound
  `cd dns-manager && docker build -t dnspm-node24-test:local .`
- [ ] Smoke-test the resulting container serves the app
  `docker run --rm -p 10010:10010 dnspm-node24-test:local`
  Then open http://localhost:10010 — expect a redirect to `/server`.
- [ ] Optional but recommended: add a build-only docker job to `.github/workflows/build.yml` so
  base-image changes fail fast on PRs instead of at release time. Tracked in `TODO.md`.

---

## 2026-08-01 07:35 | node-24-lts | Node 24 Docker image verified (resolves the 2026-07-30 entry)

Docker Desktop 29.6.2 was started and the two build/smoke steps in the entry above were run to
completion. Result: **pass, no changes required to the Dockerfile.**

- [x] `cd dns-manager && docker build -t dnspm-node24-test:local .` — all three stages succeeded.
  Next.js 16.2.12 compiled in 23.9s, TypeScript in 21.4s, 16/16 static pages generated, all 15
  routes present including `/doh` and the dynamic `/help/[slug]`.
- [x] Container smoke test on `-p 10099:10010` — `/`, `/doh`, `/wizards`, and `/help/getting-started`
  all returned HTTP 200. Runtime confirmed as `v24.18.1`, running as non-root `uid=1001(nextjs)`.
- [ ] Still open: the build-only docker CI job. `release-ghcr.yml` remains tag-only, so this
  verification has to be repeated by hand after any `dns-manager/Dockerfile` change until that
  job exists. Tracked in `TODO.md`.

Incidental observation (pre-existing, not a Node 24 regression): the runtime user lands in
`gid=65533(nogroup)` rather than the `nodejs` group the Dockerfile creates, because `adduser` is
called without `-G nodejs`. Harmless for a single-process container; noted in `TODO.md`.

---
