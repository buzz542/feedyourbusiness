import { NextResponse } from "next/server";
import { getAuthDeps } from "@/server/auth/deps";
import { guard, isSameOrigin, json } from "@/server/http/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return guard(async () => {
    const deps = getAuthDeps();
    if (!isSameOrigin(request, deps.siteUrl)) return json(403, { error: "forbidden" });
    await deps.auth.signOut();
    return NextResponse.redirect(new URL("/", deps.siteUrl), { status: 303 });
  });
}
