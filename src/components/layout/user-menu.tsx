import { LogOut } from "lucide-react";

import { signOutAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";

export function UserMenu({ name, email }: { name: string; email: string }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3">
      <div className="min-w-0 text-sm">
        <p className="truncate font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{email}</p>
      </div>
      <form action={signOutAction}>
        <Button type="submit" variant="ghost" size="icon" aria-label="Sign out" title="Sign out">
          <LogOut aria-hidden />
        </Button>
      </form>
    </div>
  );
}
