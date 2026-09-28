import { PriorityIndicator } from "@/components/shared/priority-indicator";
import { type ProjectPriority } from "@/generated/prisma/enums";

/** Icon + text, so priority is never conveyed by color alone. */
export function ProjectPriorityIndicator({ priority }: { priority: ProjectPriority }) {
  return <PriorityIndicator priority={priority} />;
}
