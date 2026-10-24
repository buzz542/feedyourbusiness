import { NextResponse } from "next/server";
import { getSignInDeps } from "@/server/auth/deps";
import { completeSignIn } from "@/server/auth/sign-in";
import { guard } from "@/server/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** PKCE callback for magic links and Google (docs/PLAN.md 12.1). */
export async function GET(request: Request) {
  return guard(async () => {
    const deps = await getSignInDeps();
    const params = new URL(request.url).searchParams;
    const path = await completeSignIn(deps, {
      code: params.get("code"),
      next: params.get("next"),
      tokenHash: params.get("token_hash"),
      type: params.get("type"),
      errorCode: params.get("error_code"),
    });
    // `path` is always a relative path chosen by completeSignIn, never user input as-is.
    return NextResponse.redirect(new URL(path, deps.siteUrl), 303);
  });
}
