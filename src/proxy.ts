import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { classifyPath, decideRoute } from "@/server/auth/route-guard";
import { loadSupabasePublicConfig, sessionCookieOptions } from "@/server/supabase/config";
import type { Database } from "@/types/database";

/**
 * Next 16 proxy (formerly middleware), docs/PLAN.md 12.1: refreshes the Supabase session cookie
 * and protects /app and /admin. The decision itself is src/server/auth/route-guard.ts.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const area = classifyPath(pathname);
  if (area === "skip") return NextResponse.next();

  let response = NextResponse.next({ request });
  let signedIn = false;
  let isAdmin = false;

  try {
    const { url, publishableKey } = loadSupabasePublicConfig();
    const supabase = createServerClient<Database>(url, publishableKey, {
      cookieOptions: sessionCookieOptions(),
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        },
      },
    });
    // getUser() validates the token with Supabase and refreshes it when it is close to expiry.
    const { data } = await supabase.auth.getUser();
    signedIn = data.user != null;
    if (area === "admin" && data.user) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", data.user.id)
        .maybeSingle();
      isAdmin = profile?.is_admin === true;
    }
  } catch (error) {
    // Fail closed: with no session check, the app redirects to sign-in and admin is a 404.
    console.error(
      `[proxy] session check failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
  }

  const decision = decideRoute(area, { signedIn, isAdmin }, `${pathname}${search}`, request.method);
  if (decision.kind === "pass") return response;

  const out =
    decision.kind === "redirect"
      ? NextResponse.redirect(new URL(decision.to, request.url))
      : new NextResponse("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  // Keep any refreshed session cookie on the redirect or 404 too.
  for (const cookie of response.cookies.getAll()) out.cookies.set(cookie);
  return out;
}

export const config = {
  matcher: [
    // Everything except static assets and the routes that must never see session logic.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|api/billing/webhook|api/cron/|api/health).*)",
  ],
};
