import { NextResponse, type NextRequest } from "next/server";
import { decideRoute, isAdminPath, isSkippedPath } from "./route-decision";
import { allowedSessionUser } from "./session-user";

type Env = Readonly<Record<string, string | undefined>>;

export interface ProxyCookie {
  name: string;
  value: string;
  options?: Parameters<NextResponse["cookies"]["set"]>[2];
}

/** What the proxy learns from the session cookie. */
export interface ProxySession {
  userId: string;
  email: string | null;
  /** Reads profiles.is_admin with the person's own client (RLS). Only called on /admin. */
  isAdmin(): Promise<boolean>;
}

export interface ProxyDeps {
  env: Env;
  /**
   * Verify (and when needed refresh) the session from the request's cookies. Refreshed cookies and
   * the no-store headers that must travel with them are handed to `onCookies`. Null when signed out.
   */
  loadSession(
    request: NextRequest,
    onCookies: (cookies: ProxyCookie[], headers: Record<string, string>) => void,
  ): Promise<ProxySession | null>;
}

/** Any path that does not exist, so a refused /admin looks exactly like an unknown page. */
export const NOT_FOUND_PATH = "/_not-found-askedfor";

/**
 * The Next 16 proxy (docs/PLAN.md 12.1, 12.10): refreshes the session, then lets decideRoute()
 * protect /app and /admin. Fails closed: an error reading the session counts as signed out.
 */
export function createProxy(deps: ProxyDeps) {
  return async function proxy(request: NextRequest): Promise<NextResponse> {
    const { pathname, search } = request.nextUrl;
    if (isSkippedPath(pathname)) return NextResponse.next();

    let response = NextResponse.next({ request });
    const cookies: ProxyCookie[] = [];
    const headers: Record<string, string> = {};
    const onCookies = (toSet: ProxyCookie[], extra: Record<string, string>) => {
      for (const { name, value } of toSet) request.cookies.set(name, value);
      response = NextResponse.next({ request });
      cookies.push(...toSet);
      Object.assign(headers, extra);
    };

    let session: ProxySession | null = null;
    try {
      session = await deps.loadSession(request, onCookies);
    } catch (error) {
      console.error(`[proxy] session check failed: ${errorName(error)}`);
      session = null;
    }

    const user = allowedSessionUser(
      session ? { id: session.userId, email: session.email } : null,
      deps.env,
    );
    let isAdmin = false;
    if (session && user && isAdminPath(pathname)) {
      try {
        isAdmin = await session.isAdmin();
      } catch (error) {
        console.error(`[proxy] admin check failed: ${errorName(error)}`);
        isAdmin = false;
      }
    }

    const decision = decideRoute({
      pathname,
      search,
      userId: session?.userId ?? null,
      allowed: user !== null,
      isAdmin,
    });

    const out =
      decision.kind === "next"
        ? response
        : decision.kind === "redirect"
          ? NextResponse.redirect(new URL(decision.to, request.url))
          : NextResponse.rewrite(new URL(NOT_FOUND_PATH, request.url));

    // Refreshed session cookies and the headers that keep them out of shared caches travel with
    // whatever response goes back.
    for (const { name, value, options } of cookies) out.cookies.set(name, value, options);
    for (const [key, value] of Object.entries(headers)) out.headers.set(key, value);
    return out;
  };
}

const errorName = (error: unknown) => (error instanceof Error ? error.name : "UnknownError");
