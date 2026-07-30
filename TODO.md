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
- **Drop the `sharp` override** once `next` widens its optional range past `^0.34.5`. The
  `>=0.35.0` pin is deliberately outside what Next tests against; it is safe today only because
  the app uses no `next/image` and configures no `images` optimizer.
- **Audit `overrides` floors on a schedule.** The `postcss` pin sat at `>=8.5.10` while a HIGH
  advisory (GHSA-r28c-9q8g-f849) covered everything through 8.5.17 — a `>=` floor goes stale
  silently and no Dependabot alert fires for it.
- **Align `@types/node`**: `dns-manager` is on `^20` while `mcp-server` is on `^25`
  (Dependabot PRs #55 and #66 propose 25/26). Decide one target rather than drifting.

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
