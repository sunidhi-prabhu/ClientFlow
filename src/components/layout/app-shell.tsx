import type { ReactNode } from "react";

import { Logo } from "@/components/layout/logo";
import { NavLinks } from "@/components/layout/nav-links";

/**
 * Authenticated application frame: sidebar on desktop, top bar with
 * horizontally scrolling navigation on small screens.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh">
      <aside className="hidden w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground md:flex">
        <div className="flex h-14 items-center px-5">
          <Logo />
        </div>
        <nav aria-label="Main" className="flex-1 px-3 py-2">
          <NavLinks orientation="vertical" />
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur md:hidden">
          <div className="flex h-14 items-center px-4">
            <Logo />
          </div>
          <nav aria-label="Main" className="px-2 pb-2">
            <NavLinks orientation="horizontal" />
          </nav>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
          {children}
        </main>
      </div>
    </div>
  );
}
