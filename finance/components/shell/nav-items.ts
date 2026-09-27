import { Activity, HandCoins, Home, LayoutGrid, Users } from "lucide-react";

/** One navigation model for both the mobile bottom bar and the desktop sidebar. */
export const NAV_ITEMS = [
  { href: "/dashboard", label: "Home", icon: Home, match: ["/dashboard"] },
  { href: "/people", label: "People", icon: Users, match: ["/people", "/contracts"] },
  { href: "/collect", label: "Collect", icon: HandCoins, match: ["/collect"] },
  { href: "/activity", label: "Activity", icon: Activity, match: ["/activity"] },
  { href: "/more", label: "More", icon: LayoutGrid, match: ["/more", "/settings"] },
] as const;

export function isActive(pathname: string, match: readonly string[]) {
  return match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}
