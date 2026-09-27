import "next-auth/jwt";

declare module "next-auth/jwt" {
  /** Contents of the encrypted session cookie. `sid` never leaves the server. */
  interface JWT {
    sid?: string;
    uid?: string;
    mobileNumber?: string;
    role?: string;
    sessionRef?: string;
  }
}
