# TODO

No high or medium priority items remain. The following are ideas for future consideration:

## Medium Priority

### Move `shadcn` to devDependencies (cuts a recurring class of CVE alerts)
`dns-manager/package.json` lists `shadcn` under `dependencies`, so the scaffolding CLI's
entire subtree lands in the **production** dependency graph: `express`, `hono`, `fast-uri`,
`body-parser`, `@modelcontextprotocol/sdk`, `jose`, `cors`, `@ts-morph/common`.
- Those packages are why `hono`/`fast-uri`/`body-parser` advisories keep appearing against a
  Next.js frontend that never serves HTTP itself — they are not runtime dependencies of the app.
- `npm run build` (`next build`) does not invoke `shadcn`; it is only run ad hoc to add components.
- Moving it to `devDependencies` should shrink the `output: "standalone"` bundle and stop most
  future transitive alerts at the source. Verify `next build` and `shadcn add` still work after.

### Dependency debt deferred from the 2026-07 security sweep
- **`eslint` 9 → 10** (PR #57): blocked upstream. `eslint-config-next` 16.2.x crashes under
  ESLint 10 inside its bundled `eslint-plugin-react` (`usedPropTypes.js:307`). This is the only
  fix for 9 dev-only HIGH advisories rooted in `brace-expansion@1.1.17` (GHSA-mh99-v99m-4gvg,
  no v1-line patch). Retry once `eslint-config-next` declares ESLint 10 support.
- ~~**Drop the `sharp` override**~~ — done 2026-10-17: `next` 16.3.8 declares `sharp ^0.35.4`
  itself, so the override was removed. (It had also gone stale: the `>=0.35.0` floor left the
  lockfile on vulnerable 0.35.3.)
- **`npm audit` findings with no non-breaking fix (2026-10-17):**
  - `braces` GHSA-vfj7-8cjw-p6xm, dev only: `eslint-config-next` → `@next/eslint-plugin-next` →
    `fast-glob@3.3.1` → `micromatch` → `braces@3.0.3`, and 3.0.3 is already the latest release.
    Recheck when `@next/eslint-plugin-next` moves off `fast-glob` 3.3.1.
  - `katex` GHSA-238p-pmpm-9mq7, low: comes in through `mermaid` 11, and the fix requires
    `mermaid` 12 (a major bump). Evaluate alongside the Resolvers diagram e2e suite.
- **Close or ignore Dependabot PRs #87 (TypeScript 7, dns-manager) and #86 (ESLint 10).** Both fail
  CI for the upstream reasons recorded here. Add `ignore` rules for those majors in
  `.github/dependabot.yml` so they stop reopening, and remove the rules when the blockers clear.
- **Group Dependabot security updates.** Add groups with `applies-to: security-updates` for each
  npm directory, so security fixes arrive as one PR per directory instead of one PR per package.
  Twenty single-package PRs piling up is how 28 alerts accumulated after v0.6.1.
- **Audit `overrides` floors on a schedule.** The `postcss` pin sat at `>=8.5.10` while a HIGH
  advisory (GHSA-r28c-9q8g-f849) covered everything through 8.5.17 — a `>=` floor goes stale
  silently and no Dependabot alert fires for it.
- ~~**Align `@types/node`**~~ — done: both workspaces are on `^24` (Active LTS line), pinned
  alongside CI, Dockerfile, `.nvmrc`, and `engines`. Dependabot now ignores `@types/node` majors.

### The Dockerfile is never exercised by PR CI
`release-ghcr.yml` triggers only on `v*.*.*` tags, so a broken `dns-manager/Dockerfile` is not
caught until release time. The Node 24 base-image bump landed unverified for this reason, and was
verified by hand on 2026-08-01 (build + container smoke test both passed — see `MANUAL_STEPS.md`).
That hand-verification is exactly what should be automated.
- Add a docker build (no push) job to `build.yml` on pull_request, or a `paths: [dns-manager/Dockerfile]`
  triggered workflow, so base-image changes fail fast.
- While in there: the runner stage calls `adduser --system --uid 1001 nextjs` without `-G nodejs`, so
  the process runs as `uid=1001(nextjs) gid=65533(nogroup)` and the `nodejs` group it creates is
  unused. Harmless today (single process, no group-owned paths), but the intent doesn't match the
  result.

### Re-evaluate Node and TypeScript on their upstream triggers
- **Node 26** becomes Active LTS **2026-10-28**; Node 24 enters maintenance **2026-10-20**. Natural
  point to move `.nvmrc`/CI/Docker/`@types/node`/`engines` together again.
- **TypeScript 7** (native Go port, currently `latest` at 7.0.2) is held back by two upstream gaps,
  both verified 2026-07-30:
  - `@typescript-eslint` 8.65.0 still declares `typescript: ">=4.8.4 <6.1.0"` — TS 7 unsupported,
    and CI gates on `npm run lint`.
  - `next build` rejects TS 7: *"does not provide the compiler API required by Next.js"*. The
    `experimental.useTypeScriptCli` flag works around it but is experimental.
  - mcp-server alone builds fine on TS 7. Worth revisiting: TS 7 typechecks dns-manager in ~6.4s
    vs ~23.5s on TS 6 (~3.6x).

### Server OS Version Detection & Feature Gating
- Query Windows Server version during `Handle-Connect` (e.g., via `[System.Environment]::OSVersion` or `Get-CimInstance Win32_OperatingSystem` on remote servers)
- Store version in `ServerInfo` and display on the Server tab (e.g., "Windows Server 2019 Build 17763")
- Use version info to gate features in the UI — disable/hide panels for unsupported cmdlets (e.g., DoH/DoT requires Server 2025+) with a clear "Requires Server 2025+" message
- Bridge handlers should check version before calling version-gated cmdlets instead of relying on error handling

## Low Priority

### MCP Server: Write Tools (v2)
- Add opt-in write tools gated behind `--allow-writes` CLI flag or `DNS_ALLOW_WRITES=true` env var
- Candidate tools: `dns_add_record`, `dns_remove_record`, `dns_add_policy`, `dns_remove_policy`, `dns_create_subnet`, `dns_clear_cache`
- Each write tool should require explicit confirmation in the tool response before executing

### MCP Server: Streamable HTTP Transport
- Add HTTP transport alongside stdio for remote AI agent access
- Would require the bridge to bind beyond localhost or use a reverse proxy

### OpenAPI Spec Generation
Auto-generate an OpenAPI spec from bridge.ps1's route definitions for documentation and client generation.
