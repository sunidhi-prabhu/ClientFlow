import { Logo } from "@/components/layout/logo";

export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <Logo className="mb-8" />
      <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-sm ring-1 ring-foreground/10 sm:p-8">
        {children}
      </div>
    </div>
  );
}
