# TODO

## Wizard Execution: Use Typed API Endpoints

Currently `wizardExecute()` sends each command line to the bridge's `/api/execute` endpoint sequentially. This works but relies on the `Handle-Execute` allowlist and treats all commands as opaque strings.

**Future improvement:** Refactor wizard execution to call typed API endpoints directly (e.g., `api.createSubnet()`, `api.createZoneScope()`, `api.addPolicy()`) instead of `/api/execute`. This would provide structured error handling per object type, bypass the allowlist dependency, and make rollback on partial failure feasible.
