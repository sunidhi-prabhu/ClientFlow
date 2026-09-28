import { ActivityTimeline } from "@/components/shared/activity-timeline";
import { type ClientActivityType } from "@/generated/prisma/enums";

export type ClientActivityItem = {
  id: string;
  type: ClientActivityType;
  changes: unknown;
  createdAt: Date;
  actor: { name: string; email: string } | null;
};

const FIELD_LABELS: Record<string, string> = {
  name: "name",
  company: "company",
  email: "email",
  phone: "phone",
  address: "address",
  notes: "notes",
  status: "status",
};

export function describeClientActivity(item: ClientActivityItem): string {
  switch (item.type) {
    case "CREATED":
      return "added this client";
    case "ARCHIVED":
      return "archived this client";
    case "RESTORED":
      return "restored this client";
    case "UPDATED": {
      const fields = Object.keys((item.changes as Record<string, unknown> | null) ?? {})
        .map((field) => FIELD_LABELS[field] ?? field)
        .filter(Boolean);
      return fields.length > 0 ? `updated ${fields.join(", ")}` : "updated this client";
    }
  }
}

export function ClientActivityList({ items }: { items: ClientActivityItem[] }) {
  return (
    <ActivityTimeline
      items={items.map((item) => ({
        id: item.id,
        actorName: item.actor?.name ?? null,
        description: describeClientActivity(item),
        createdAt: item.createdAt,
      }))}
    />
  );
}
