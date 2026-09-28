import Link from "next/link";

import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
      <div className="space-y-1">
        <p className="text-sm font-medium text-primary">404</p>
        <h1 className="text-xl font-semibold">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          The page you are looking for does not exist or you do not have access to it.
        </p>
      </div>
      <Link href="/" className={buttonVariants()}>
        Back to overview
      </Link>
    </main>
  );
}
