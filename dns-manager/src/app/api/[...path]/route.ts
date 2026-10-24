import { bridgePath, bridgeToken, bridgeUrl, checkProxyRequest } from "@/lib/bridge-proxy";

// Proxies every browser /api/* call to the PowerShell bridge, adding the bridge token
// server-side. See src/lib/bridge-proxy.ts for the request checks.
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

  const search = new URL(request.url).search;
  const method = request.method.toUpperCase();
  const body = method === "GET" || method === "HEAD" ? undefined : await request.arrayBuffer();

  let upstream: Response;
  try {
    upstream = await fetch(`${bridgeUrl()}${target}${search}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": request.headers.get("content-type") || "application/json",
      },
      body: body && body.byteLength > 0 ? body : undefined,
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
