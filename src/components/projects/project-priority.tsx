import { ChevronDown, ChevronsUp, ChevronUp, Equal } from "lucide-react";

import { type ProjectPriority } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

import { PROJECT_PRIORITY_LABELS } from "./project-labels";

const STYLES = {
  LOW: { icon: ChevronDown, className: "text-muted-foreground" },
  MEDIUM: { icon: Equal, className: "text-foreground" },
  HIGH: { icon: ChevronUp, className: "text-amber-600 dark:text-amber-400" },
  URGENT: { icon: ChevronsUp, className: "text-destructive" },
} satisfies Record<ProjectPriority, { icon: unknown; className: string }>;

/** Icon + text, so priority is never conveyed by color alone. */
export function ProjectPriorityIndicator({ priority }: { priority: ProjectPriority }) {
  const { icon: Icon, className } = STYLES[priority];
  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", className)}>
      <Icon className="size-4" aria-hidden />
      {PROJECT_PRIORITY_LABELS[priority]}
    </span>
  );
}
