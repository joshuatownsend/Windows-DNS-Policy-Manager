import {
  bridgePath,
  bridgeToken,
  bridgeUrl,
  checkBodyType,
  checkProxyRequest,
  hasValidSession,
  readBodyCapped,
} from "@/lib/bridge-proxy";

// Proxies every browser /api/* call to the PowerShell bridge, adding the bridge token
// server-side. Callers must hold the session cookie set by /auth. See src/lib/bridge-proxy.ts.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Context = { params: Promise<{ path: string[] }> };

function json(status: number, body: Record<string, unknown>): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

async function proxy(request: Request, { params }: Context): Promise<Response> {
  const rejection = checkProxyRequest(request.method, request.headers);
  if (rejection) return json(rejection.status, { success: false, error: rejection.error });

  const { path } = await params;
  const target = bridgePath(path);
  if (!target) return json(400, { success: false, error: "Invalid API path" });

  const token = bridgeToken();
  if (!token) {
    return json(503, {
      success: false,
      bridgeDown: true,
      error: "Bridge token not found. Start the bridge, or set BRIDGE_TOKEN for the frontend.",
    });
  }

  // The health probe stays open so the header can show bridge status before sign-in.
  if (target !== "/api/health" && !hasValidSession(request.headers.get("cookie"), token)) {
    return json(401, {
      success: false,
      authRequired: true,
      error: "Not signed in. Open the sign-in link the launcher printed, or sign in at /login.",
    });
  }

  const method = request.method.toUpperCase();
  let body: Uint8Array | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const read = await readBodyCapped(request.body);
    if (!read) return json(413, { success: false, error: "Request body too large" });
    const typeRejection = checkBodyType(request.headers.get("content-type"), read.byteLength);
    if (typeRejection) return json(typeRejection.status, { success: false, error: typeRejection.error });
    body = read.byteLength > 0 ? read : undefined;
  }

  let upstream: Response;
  try {
    upstream = await fetch(`${bridgeUrl()}${target}${new URL(request.url).search}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": request.headers.get("content-type") || "application/json",
      },
      body: body as BodyInit | undefined,
      cache: "no-store",
      redirect: "manual",
    });
  } catch (err) {
    return json(502, {
      success: false,
      bridgeDown: true,
      error: `Bridge unreachable: ${err instanceof Error ? err.message : String(err)}`,
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type": upstream.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const DELETE = proxy;
