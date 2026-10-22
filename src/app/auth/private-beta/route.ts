import { NextResponse } from "next/server";
import { getAuthDeps } from "@/server/auth/deps";
import { leavePrivateBeta } from "@/server/auth/sign-in";
import { getSessionUser } from "@/server/auth/supabase-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Signs out a session that belongs to someone off the allowlist. A no-op for everyone else. */
export async function GET(request: Request) {
  let location = "/login?error=error";
  try {
    location = await leavePrivateBeta(getAuthDeps(), await getSessionUser());
  } catch (error) {
    console.error(
      `[auth] private beta exit failed: ${error instanceof Error ? error.name : "Unknown"}`,
    );
  }
  return NextResponse.redirect(new URL(location, new URL(request.url).origin), { status: 303 });
}
