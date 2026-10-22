import { NextResponse } from "next/server";
import { track } from "@/server/analytics/supabase-store";
import { getAuthDeps } from "@/server/auth/deps";
import { handleAuthCallback } from "@/server/auth/sign-in";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Exchanges the auth code (PKCE) or verifies the email token hash, then redirects to a safe path. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const p = url.searchParams;
  let location = "/login?error=error";
  try {
    const result = await handleAuthCallback(getAuthDeps(), {
      code: p.get("code"),
      tokenHash: p.get("token_hash"),
      type: p.get("type"),
      next: p.get("next"),
    });
    location = result.location;
    if (result.newUserId) await track("signed_up", result.newUserId);
  } catch (error) {
    console.error(
      `[auth] callback route failed: ${error instanceof Error ? error.name : "Unknown"}`,
    );
  }
  return NextResponse.redirect(new URL(location, url.origin), { status: 303 });
}
