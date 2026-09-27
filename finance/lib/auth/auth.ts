import "server-only";
import { headers } from "next/headers";
import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { describeDbError } from "@/lib/db/describe-error";
import { loginSchema } from "@/lib/validation/auth";
import { authenticateWithPassword, type AuthFailure } from "./authenticate";
import { logoutSession } from "./account";
import { jwtCallback, sessionCallback } from "./callbacks";
import { hashToken, SESSION_TTL_MS } from "./tokens";

export type { SessionUser } from "./callbacks";

/** The `code` travels to the login action; it is one of three fixed strings, never internal detail. */
class LoginRejected extends CredentialsSignin {
  constructor(code: AuthFailure) {
    super();
    this.code = code;
  }
}

function clientIp(headers: Headers): string | null {
  return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip") || null;
}

/**
 * Auth.js v5 with the Credentials provider. Auth.js only supports the JWT
 * strategy for credentials, so we use the JWT (encrypted with AUTH_SECRET,
 * httpOnly cookie) purely as a carrier for a random session id. The
 * `sessions` table is the authority: every request re-validates the row, so
 * logout / password change / account disable take effect immediately.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  secret: process.env.AUTH_SECRET,
  trustHost: true,
  debug: false, // debug logging would include request bodies (credentials)
  useSecureCookies: process.env.NODE_ENV === "production",
  session: { strategy: "jwt", maxAge: SESSION_TTL_MS / 1000, updateAge: 0 },
  jwt: { maxAge: SESSION_TTL_MS / 1000 },
  pages: { signIn: "/login", error: "/login" },
  providers: [
    Credentials({
      credentials: { mobileNumber: {}, password: {} },
      async authorize(credentials, request) {
        const parsed = loginSchema.safeParse(credentials);
        if (!parsed.success) throw new LoginRejected("invalid_credentials");
        const outcome = await authenticateWithPassword({
          ...parsed.data,
          ipAddress: clientIp(request.headers),
          userAgent: request.headers.get("user-agent"),
        });
        if (!outcome.ok) throw new LoginRejected(outcome.reason);
        return { id: outcome.user.id, sessionToken: outcome.sessionToken };
      },
    }),
  ],
  callbacks: { jwt: jwtCallback, session: sessionCallback },
  events: {
    // Every sign-out path (our logout action or Auth.js's own endpoint) revokes the DB session.
    async signOut(message) {
      const token = "token" in message ? message.token : null;
      if (typeof token?.sid !== "string") return;
      let meta: { ipAddress: string | null; userAgent: string | null } = { ipAddress: null, userAgent: null };
      try {
        const h = await headers();
        meta = { ipAddress: clientIp(h), userAgent: h.get("user-agent")?.slice(0, 500) ?? null };
      } catch {
        // outside a request scope
      }
      await logoutSession(hashToken(token.sid), { userId: typeof token.uid === "string" ? token.uid : null, ...meta });
    },
  },
  logger: {
    error(error) {
      // Rejected logins are expected and already in the audit log.
      const type = (error as { type?: string }).type ?? "UnknownError";
      if (type === "CredentialsSignin") return;
      // Log the Auth.js error type plus the underlying cause only — never the request (it holds credentials).
      const cause = (error as { cause?: { err?: Error } }).cause?.err;
      console.error(`[auth] ${type}${cause ? ` → ${describeDbError(cause)}` : ""}`);
    },
    warn(code) {
      console.warn(`[auth] warning ${code}`);
    },
  },
});
