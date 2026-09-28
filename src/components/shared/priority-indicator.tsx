import { ChevronDown, ChevronsUp, ChevronUp, Equal } from "lucide-react";

import { cn } from "@/lib/utils";

/** Priority levels shared by projects and tasks (same values in both enums). */
export type Priority = "LOW" | "MEDIUM" | "HIGH" | "URGENT";

export const PRIORITY_LABELS: Record<Priority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  URGENT: "Urgent",
};

const STYLES = {
  LOW: { icon: ChevronDown, className: "text-muted-foreground" },
  MEDIUM: { icon: Equal, className: "text-foreground" },
  HIGH: { icon: ChevronUp, className: "text-amber-600 dark:text-amber-400" },
  URGENT: { icon: ChevronsUp, className: "text-destructive" },
} satisfies Record<Priority, { icon: unknown; className: string }>;

/** Icon + text, so priority is never conveyed by color alone. */
export function PriorityIndicator({ priority }: { priority: Priority }) {
  const { icon: Icon, className } = STYLES[priority];
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", className)}>
      <Icon className="size-4" aria-hidden />
      {PRIORITY_LABELS[priority]}
    </span>
  );
}
