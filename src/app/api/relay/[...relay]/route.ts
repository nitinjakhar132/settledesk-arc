import { relayCatalog } from "@/lib/relay-server";

const BASE = "https://api.relay.link";
const ALLOWED = new Set([
  "chains",
  "intents/status",
  "intents/status/v2",
  "intents/status/v3",
  "execute/permit",
]);

async function handler(
  request: Request,
  { params }: { params: Promise<{ relay: string[] }> },
) {
  const path = (await params).relay.join("/");
  if (path === "catalog" && request.method === "GET")
    return Response.json(await relayCatalog(), {
      headers: { "Cache-Control": "public, max-age=60" },
    });
  if (!ALLOWED.has(path))
    return Response.json(
      { message: "Relay route not allowed." },
      { status: 404 },
    );
  const url = new URL(`${BASE}/${path}`);
  const incoming = new URL(request.url);
  incoming.searchParams.forEach((value, key) =>
    url.searchParams.set(key, value),
  );
  const headers = new Headers({ Accept: "application/json" });
  if (process.env.RELAY_API_KEY)
    headers.set("x-api-key", process.env.RELAY_API_KEY);
  const body = request.method === "GET" ? undefined : await request.text();
  if (body) headers.set("Content-Type", "application/json");
  const response = await fetch(url, {
    method: request.method,
    headers,
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(25_000),
  });
  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}

export const dynamic = "force-dynamic";
export { handler as GET, handler as POST };
