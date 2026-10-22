import { NextResponse } from "next/server";
import { PRIVATE_BETA_MESSAGE } from "@/server/auth/allowlist";
import { getAuthDeps } from "@/server/auth/deps";
import { leavePrivateBeta } from "@/server/auth/sign-in";
import { getSessionUser } from "@/server/auth/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Signs out a session that belongs to someone off the allowlist. A no-op for everyone else. */
export async function GET(request: Request) {
  try {
    const location = await leavePrivateBeta(getAuthDeps(), await getSessionUser());
    return NextResponse.redirect(new URL(location, new URL(request.url).origin), { status: 303 });
  } catch (error) {
    console.error(
      `[auth] private beta exit failed: ${error instanceof Error ? error.name : "Unknown"}`,
    );
    // A page, not a redirect: with the session still in place, /login would bounce back to /app.
    return new NextResponse(`${PRIVATE_BETA_MESSAGE} Sign-in is open to invited emails only.`, {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
}
