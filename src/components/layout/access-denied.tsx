import { ShieldAlert } from "lucide-react";

/** Rendered by pages when the member's role lacks the required permission. */
export function AccessDenied({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center">
      <ShieldAlert className="size-6 text-muted-foreground" aria-hidden />
      <div className="space-y-1">
        <h1 className="font-medium">You don&apos;t have access to this page</h1>
        <p className="text-sm text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}
