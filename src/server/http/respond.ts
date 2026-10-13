export function json(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers,
    },
  });
}

/**
 * CSRF defence for cookie-authenticated POST routes. Browsers always send Sec-Fetch-Site and
 * Origin on cross-site requests. We accept a same-origin request, or an Origin that matches the
 * configured site URL, and refuse everything else (including requests with neither header).
 */
export function isSameOrigin(request: Request, siteUrl: string): boolean {
  if (request.headers.get("sec-fetch-site") === "same-origin") return true;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(siteUrl).origin;
  } catch {
    return false;
  }
}

/**
 * Wrap a route so that a failure outside the handler's own error handling (for example missing
 * configuration while building dependencies) becomes a clear JSON 500 instead of a bare one.
 * Logs the error class only, never its message, which may contain secrets.
 */
export async function guard(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    console.error(`[route] failed: ${error instanceof Error ? error.name : "UnknownError"}`);
    return json(500, { error: "server_misconfigured" });
  }
}

/**
 * Read a request body as text, refusing anything larger than `maxBytes`. Returns null when the
 * body is too large. Unauthenticated endpoints (the Stripe webhook) must not buffer unbounded input.
 */
export async function readBodyText(request: Request, maxBytes = 1_000_000): Promise<string | null> {
  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  if (!request.body) return "";

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel();
      return null;
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}
