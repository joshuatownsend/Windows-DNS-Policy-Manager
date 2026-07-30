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
