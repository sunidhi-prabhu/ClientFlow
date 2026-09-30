import Link from "next/link";

import { BUSINESS, LEGAL_PAGES } from "@/config/business";

/** Public footer: the business behind ClientFlow and links to its policies. */
export function SiteFooter() {
  return (
    <footer className="border-t">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:px-6">
        <nav aria-label="Policies">
          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 sm:justify-start">
            {LEGAL_PAGES.map((page) => (
              <li key={page.href}>
                <Link href={page.href} className="hover:text-foreground hover:underline">
                  {page.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p className="text-center sm:text-left">
          {BUSINESS.productName} is operated by {BUSINESS.legalName} (
          {BUSINESS.entityType.toLowerCase()}), {BUSINESS.city}, {BUSINESS.state},{" "}
          {BUSINESS.country}.{BUSINESS.gstin && ` GSTIN ${BUSINESS.gstin}.`}
        </p>
      </div>
    </footer>
  );
}
