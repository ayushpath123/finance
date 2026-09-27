import type { ReactNode } from "react";

/**
 * Primary action pinned just above the bottom nav on phones (thumb reach),
 * with a solid fade so it never sits on top of form fields. Static on desktop.
 */
export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-16 z-10 -mx-4 bg-gradient-to-t from-background via-background to-background/0 px-4 pt-6 pb-3 md:static md:mx-0 md:bg-none md:px-0 md:pt-2 md:pb-0">
      {children}
    </div>
  );
}
