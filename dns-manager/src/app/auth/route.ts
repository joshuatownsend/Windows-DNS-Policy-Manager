import { bridgeToken, checkProxyRequest, isBridgeToken, sessionCookie } from "@/lib/bridge-proxy";

// Sign-in: exchanges the bridge token for an HttpOnly session cookie.
//   GET  /auth?token=...   — the link Start-DNSPolicyManager.ps1 opens
//   POST /auth (form)      — the /login page
// The token itself never goes into the cookie or back to the page.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function redirect(to: string, cookie?: string): Response {
  // Only ever an app-relative path chosen here, never one taken from the request.
  const headers = new Headers({ Location: to, "Cache-Control": "no-store" });
  if (cookie) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 303, headers });
}

function signIn(request: Request, presented: string): Response {
  const rejection = checkProxyRequest("GET", request.headers);
  if (rejection) return Response.json({ success: false, error: rejection.error }, { status: rejection.status });

  const token = bridgeToken();
  if (!token) return redirect("/login?error=no-token");
  if (!isBridgeToken(presented, token)) return redirect("/login?error=invalid");

  const secure = new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto") === "https";
  return redirect("/server", sessionCookie(token, secure));
}

export async function GET(request: Request): Promise<Response> {
  return signIn(request, new URL(request.url).searchParams.get("token") || "");
}

export async function POST(request: Request): Promise<Response> {
  let presented = "";
  try {
    const form = await request.formData();
    presented = String(form.get("token") || "");
  } catch {
    // fall through with an empty token
  }
  return signIn(request, presented);
}
