import Link from "next/link";

import { SiteFooter } from "@/components/legal/site-footer";
import { Logo } from "@/components/layout/logo";
import { buttonVariants } from "@/components/ui/button";

/** Public policy pages (terms, privacy, refunds, delivery, contact). */
export default function LegalLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <Link href="/#pricing" className={buttonVariants({ variant: "ghost" })}>
            Pricing
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
      <SiteFooter />
    </div>
  );
}
