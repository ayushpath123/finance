import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic, cookie-only gate (no DB access — Proxy also runs for prefetches).
 * The authoritative check is requireAdmin()/requireAdminActor() in every page
 * and server action, which validates the session row on each request.
 */
const PUBLIC_PATHS = ["/login", "/access-denied"];
const SESSION_COOKIES = ["authjs.session-token", "__Secure-authjs.session-token"];

export function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies.getAll().some((c) => SESSION_COOKIES.some((name) => c.name === name || c.name.startsWith(`${name}.`)));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!isPublic && !hasSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const response = NextResponse.next();
  // Authenticated pages must never be served from cache or the back/forward cache after logout.
  if (!isPublic) response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

export const config = {
  // Everything except Auth.js endpoints, the cron endpoint (bearer-token protected), and static assets.
  matcher: ["/((?!api/auth|api/cron|_next/static|_next/image|favicon.ico|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
