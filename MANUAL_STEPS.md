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

## 2026-10-24 17:35 | bridge-auth | Bridge token authentication and credential host binding (#138, #139, #145)

Applies once the bridge-auth PR is merged and released (v0.7.0). Local one-command launches
(`Start-DNSPolicyManager.ps1`) need no action: the bridge writes its token file and the
frontend reads it.

- [ ] Re-enter saved/session credentials for every server that uses them
  Credentials are now bound to the hostname they were stored for. Ones saved before this
  release have no bound host, so the bridge refuses them until they are re-entered once.
  Server tab → edit each server → enter username and password → Save.
- [ ] Docker deployments: create a `.env` next to `docker-compose.yml` with a shared token
  `BRIDGE_TOKEN=<long random string>` (e.g. `openssl rand -base64 32`)
  `docker compose up` now fails fast if it is missing.
- [ ] Docker deployments: restart the host bridge with the same token and an explicit remote opt-in
  `$env:DNS_BRIDGE_TOKEN = '<same string>'`
  `powershell -ExecutionPolicy Bypass -File server/bridge.ps1 -BindAddress 0.0.0.0 -AllowRemote`
  (The container reaches the bridge over Docker's network, so loopback-only binding no longer works for Docker.)
- [ ] Docker deployments: rebuild the image (`docker compose up -d --build`)
  `BRIDGE_URL` moved from a build arg to a runtime environment variable, so old images still
  carry the removed rewrite.
- [ ] Anyone running the bridge with `-BindAddress 0.0.0.0` (or another non-loopback address): add `-AllowRemote`
  Without it the bridge now exits with an error.
- [ ] Optional, recommended for remote bridges: serve the bridge over HTTPS
  Bind a certificate to the port, then start with `-UseHttps`:
  `netsh http add sslcert ipport=0.0.0.0:8650 certhash=<cert thumbprint> appid={<any GUID>}`
  See: https://learn.microsoft.com/windows/win32/http/add-sslcert
- [ ] MCP server registrations on another machine or under another Windows user: add the token
  `claude mcp add dns-policy-manager -e BRIDGE_URL=... -e BRIDGE_TOKEN=<token> -- node /path/to/mcp-server/dist/index.js`
  Same-user, same-machine setups read `%LOCALAPPDATA%\DNSPolicyManager\bridge.token` automatically.
- [ ] Opening the app under a hostname other than localhost: set `ALLOWED_HOSTS`
  e.g. `ALLOWED_HOSTS=dns-admin.contoso.com` in the frontend environment (or `.env` for Docker).
- [ ] Sign each browser in once
  The launcher does this automatically. For Docker or manual starts, open
  `http://localhost:10010/auth?token=<token>`, or paste the token on the sign-in page.
- [ ] Docker deployments reached from other machines: compose now publishes `127.0.0.1:10010` only
  Change the port mapping to `"10010:10010"`, add the hostname to `ALLOWED_HOSTS`, and put TLS in front.

---
