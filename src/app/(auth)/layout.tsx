import { AuthShowcase } from "@/components/auth/auth-showcase";
import { Logo } from "@/components/layout/logo";

/**
 * Sign-in, sign-up and account-recovery pages. Small screens show the form
 * card alone; large screens split into the form and a "How ClientFlow works"
 * walkthrough.
 */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <main className="flex flex-col items-center justify-center bg-muted/40 px-4 py-10 lg:bg-background lg:px-10">
        <Logo className="mb-8" />
        <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-sm ring-1 ring-foreground/10 sm:p-8 lg:bg-transparent lg:p-0 lg:shadow-none lg:ring-0">
          {children}
        </div>
      </main>
      <AuthShowcase className="hidden lg:sticky lg:top-0 lg:flex lg:h-dvh lg:items-center" />
    </div>
  );
}
