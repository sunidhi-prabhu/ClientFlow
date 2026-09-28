import { Logo } from "@/components/layout/logo";
import { requireSessionOrRedirect } from "@/server/auth/session";

export default async function OnboardingLayout({ children }: LayoutProps<"/">) {
  await requireSessionOrRedirect();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <Logo className="mb-8" />
      <div className="w-full max-w-md rounded-xl bg-card p-6 shadow-sm ring-1 ring-foreground/10 sm:p-8">
        {children}
      </div>
    </main>
  );
}
