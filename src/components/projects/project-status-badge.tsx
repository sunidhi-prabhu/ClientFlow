import { Badge } from "@/components/ui/badge";
import { type ProjectStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

import { PROJECT_STATUS_LABELS } from "./project-labels";

const STYLES: Record<ProjectStatus, { badge: string; dot: string }> = {
  PLANNING: { badge: "bg-sky-500/10 text-sky-700 dark:text-sky-400", dot: "bg-sky-500" },
  ACTIVE: {
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  ON_HOLD: { badge: "bg-amber-500/10 text-amber-700 dark:text-amber-400", dot: "bg-amber-500" },
  COMPLETED: { badge: "bg-primary/10 text-primary", dot: "bg-primary" },
  ARCHIVED: {
    badge: "border-border bg-transparent text-muted-foreground",
    dot: "bg-muted-foreground/60",
  },
};

export function ProjectStatusBadge({ status }: { status: ProjectStatus }) {
  return (
    <Badge variant="secondary" className={cn("gap-1.5", STYLES[status].badge)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", STYLES[status].dot)} />
      {PROJECT_STATUS_LABELS[status]}
    </Badge>
  );
}
