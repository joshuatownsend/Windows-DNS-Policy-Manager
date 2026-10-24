import { bridgeToken, checkProxyRequest, consumeSignInCode, isBridgeToken, sessionCookie } from "@/lib/bridge-proxy";

// Sign-in: issues an HttpOnly session cookie.
//   GET  /auth?code=...   — one-time code from Start-DNSPolicyManager.ps1 (see consumeSignInCode)
//   POST /auth (form)     — the bridge token pasted on the /login page
// The bridge token is never accepted in a URL, and never goes into the cookie or back to the page.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirect(to: string, cookie?: string): Response {
  // Only ever an app-relative path chosen here, never one taken from the request.
  const headers = new Headers({ Location: to, "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function signIn(request: Request, accept: (token: string) => boolean, failure: string): Response {
  const rejection = checkProxyRequest("GET", request.headers);
  if (rejection) return Response.json({ success: false, error: rejection.error }, { status: rejection.status });

  const token = bridgeToken();
  if (!token) return redirect("/login?error=no-token");
  if (!accept(token)) return redirect(`/login?error=${failure}`);

  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  return redirect("/server", sessionCookie(token, secure));
}

export async function GET(request: Request): Promise<Response> {
  const code = new URL(request.url).searchParams.get("code") || "";
  return signIn(request, () => consumeSignInCode(code), "expired");
}

export async function POST(request: Request): Promise<Response> {
  let presented = "";
  try {
    const form = await request.formData();
    presented = String(form.get("token") || "");
  } catch {
    // fall through with an empty token
  }
  return signIn(request, (token) => isBridgeToken(presented, token), "invalid");
}
