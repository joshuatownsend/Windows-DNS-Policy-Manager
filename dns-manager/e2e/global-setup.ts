import { createHmac } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

// Signs every test browser in: the /api proxy requires the session cookie that /auth sets.
// Same derivation as sessionValue() in src/lib/bridge-proxy.ts, for the token start-test.mjs uses.
export const E2E_BRIDGE_TOKEN = "e2e-bridge-token";
export const STORAGE_STATE = join(__dirname, ".auth", "state.json");

export default function globalSetup() {
  const value = createHmac("sha256", E2E_BRIDGE_TOKEN).update("dpm-ui-session-v1").digest("base64url");
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  writeFileSync(
    STORAGE_STATE,
    JSON.stringify({
      cookies: [
        { name: "dpm_session", value, domain: "localhost", path: "/", expires: -1, httpOnly: true, secure: false, sameSite: "Strict" },
      ],
      origins: [],
    }),
  );
}
