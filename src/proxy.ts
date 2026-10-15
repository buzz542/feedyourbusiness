import { createServerClient } from "@supabase/ssr";
import { createProxy } from "@/server/auth/proxy-handler";
import type { Database } from "@/types/database";

/**
 * Next 16 proxy (formerly middleware), docs/PLAN.md 12.1. The logic lives in createProxy() and is
 * unit tested with a fake session; this file only wires Supabase in. Pages check the session again
 * on the server: this is the first gate, not the only one.
 */
export const proxy = createProxy({
  env: process.env,
  async loadSession(request, onCookies) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) return null; // Fail closed: no configuration, nobody is signed in.

    const supabase = createServerClient<Database>(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => onCookies(toSet, headers),
      },
    });
    // Verifies the session token and refreshes it when it has expired.
    const { data } = await supabase.auth.getClaims();
    const userId = typeof data?.claims?.sub === "string" ? data.claims.sub : null;
    if (!userId) return null;
    return {
      userId,
      email: typeof data?.claims?.email === "string" ? data.claims.email : null,
      async isAdmin() {
        const { data: profile } = await supabase
          .from("profiles")
          .select("is_admin")
          .eq("id", userId)
          .maybeSingle();
        return profile?.is_admin === true;
      },
    };
  },
});

export const config = {
  matcher: [
    // Protected sections always run the proxy, whatever the path ends in ("/admin/x/1.txt").
    "/app/:path*",
    "/admin/:path*",
    // Everything else, except the webhook, crons, health check and static files.
    "/((?!api/billing/webhook$|api/cron(?:/|$)|api/health$|_next/static/|_next/image|.*\\.(?:ico|png|jpg|jpeg|gif|webp|avif|svg|woff2?|txt|xml|webmanifest)$).*)",
  ],
};
