import { ProgressBar } from "@/components/shared/progress-bar";
import { type Usage } from "@/lib/billing";
import { cn } from "@/lib/utils";

/** "7 / 50 clients" with a bar, remaining capacity and any overage after a downgrade. */
export function UsageMeter({ label, usage }: { label: "clients" | "projects"; usage: Usage }) {
  const percent = usage.limit > 0 ? (usage.used / usage.limit) * 100 : 100;
  return (
    <div className="space-y-2 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-medium capitalize">Active {label}</h3>
        <p className="text-sm tabular-nums" data-testid={`usage-${label}`}>
          <span className="font-semibold">{usage.used}</span>
          <span className="text-muted-foreground"> / {usage.limit}</span>
        </p>
      </div>
      <ProgressBar value={percent} label={`${label} used`} />
      <p
        className={cn(
          "text-xs",
          usage.overBy > 0 || usage.atLimit ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {usage.overBy > 0
          ? `${usage.overBy} over your plan's limit. Existing ${label} stay fully usable; upgrade to add more.`
          : usage.atLimit
            ? `Limit reached. Upgrade to add more ${label}.`
            : `${usage.remaining} more ${usage.remaining === 1 ? label.slice(0, -1) : label} available.`}
      </p>
    </div>
  );
}
