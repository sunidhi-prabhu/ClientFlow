import { ActivityTimeline } from "@/components/shared/activity-timeline";
import { type ProjectActivityType } from "@/generated/prisma/enums";

import { PROJECT_STATUS_LABELS } from "./project-labels";

export type ProjectActivityItem = {
  id: string;
  type: ProjectActivityType;
  changes: unknown;
  createdAt: Date;
  actor: { name: string; email: string } | null;
};

const FIELD_LABELS: Record<string, string> = {
  name: "name",
  description: "description",
  clientId: "client",
  priority: "priority",
  startDate: "start date",
  dueDate: "due date",
  progress: "progress",
};

type Changes = Record<string, { from?: unknown; to?: unknown }> & {
  member?: { name?: string };
};

function statusLabel(value: unknown) {
  return typeof value === "string" && value in PROJECT_STATUS_LABELS
    ? PROJECT_STATUS_LABELS[value as keyof typeof PROJECT_STATUS_LABELS]
    : "unknown";
}

function describe(item: ProjectActivityItem): string {
  const changes = (item.changes ?? {}) as Changes;
  switch (item.type) {
    case "CREATED":
      return "created this project";
    case "ARCHIVED":
      return "archived this project";
    case "RESTORED":
      return "restored this project";
    case "STATUS_CHANGED":
      return `changed the status from ${statusLabel(changes.status?.from)} to ${statusLabel(changes.status?.to)}`;
    case "MEMBER_ADDED":
      return `added ${changes.member?.name ?? "a member"} to the project`;
    case "MEMBER_REMOVED":
      return `removed ${changes.member?.name ?? "a member"} from the project`;
    case "UPDATED": {
      if (Object.keys(changes).length === 1 && changes.progress) {
        return `set progress to ${String(changes.progress.to)}%`;
      }
      const fields = Object.keys(changes).map((field) => FIELD_LABELS[field] ?? field);
      return fields.length > 0 ? `updated ${fields.join(", ")}` : "updated this project";
    }
  }
}

export function ProjectActivityList({ items }: { items: ProjectActivityItem[] }) {
  return (
    <ActivityTimeline
      items={items.map((item) => ({
        id: item.id,
        actorName: item.actor?.name ?? null,
        description: describe(item),
        createdAt: item.createdAt,
      }))}
    />
  );
}
