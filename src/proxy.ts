import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { PATH_HEADER } from "@/server/auth/next-step";
import { decideRoute, needsSession, type RouteUser } from "@/server/auth/route-decision";
import { loadSupabasePublicConfig } from "@/server/supabase/config";
import type { Database } from "@/types/database";

/**
 * Next 16 proxy (formerly middleware). Refreshes the Supabase session cookie and protects `/app`
 * and `/admin` (docs/PLAN.md 12.1). The routing rules live in route-decision.ts. Pages and actions
 * still check the user themselves: the proxy is the first gate, not the only one.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  if (!needsSession(pathname)) return NextResponse.next();

  // Pass the path to server layouts (they gate on it). Always overwritten, never trusted from the client.
  const forward = () => {
    const headers = new Headers(request.headers);
    headers.set(PATH_HEADER, pathname);
    return NextResponse.next({ request: { headers } });
  };
  let response = forward();
  let user: RouteUser | null = null;
  try {
    const { url, publishableKey } = loadSupabasePublicConfig();
    const supabase = createServerClient<Database>(url, publishableKey, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = forward();
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    });
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      let isAdmin = false;
      if (pathname === "/admin" || pathname.startsWith("/admin/")) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("is_admin")
          .eq("id", data.user.id)
          .maybeSingle();
        isAdmin = profile?.is_admin === true;
      }
      user = { id: data.user.id, isAdmin };
    }
  } catch (error) {
    // Missing config or Supabase unreachable: treat as signed out, so protected paths stay closed.
    console.error(
      `[proxy] session check failed: ${error instanceof Error ? error.name : "Unknown"}`,
    );
  }

  const decision = decideRoute(pathname, search, user);
  if (decision.kind === "redirect") {
    const redirect = NextResponse.redirect(new URL(decision.location, request.url));
    for (const cookie of response.cookies.getAll()) redirect.cookies.set(cookie);
    return redirect;
  }
  if (decision.kind === "not_found") {
    return new NextResponse("Not found", {
      status: 404,
      headers: { "content-type": "text/plain" },
    });
  }
  return response;
}

export const config = {
  matcher: [
    // Everything except webhook, cron, health and static assets (route-decision.ts checks again).
    "/((?!api/billing/webhook|api/cron|api/health|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|woff2?)$).*)",
  ],
};
