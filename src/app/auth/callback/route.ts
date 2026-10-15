import { NextResponse } from "next/server";
import { handleAuthCallback } from "@/server/auth/sign-in";
import { createCallbackDeps } from "@/server/auth/supabase-auth";
import { createSupabaseServerClient } from "@/server/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Finishes sign-in (docs/PLAN.md 12.1): exchanges the code, then goes to a safe relative path. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  let path = "/login?error=link";
  try {
    const supabase = await createSupabaseServerClient();
    path = await handleAuthCallback(createCallbackDeps(supabase, new Date()), url);
  } catch (error) {
    console.error(
      `[auth] callback failed: ${error instanceof Error ? error.name : "UnknownError"}`,
    );
  }
  // `path` is relative (safeNextPath); refuse anything that would still resolve off this site.
  let target = new URL(path, url.origin);
  if (target.origin !== url.origin) target = new URL("/app", url.origin);
  return NextResponse.redirect(target, { status: 303 });
}
