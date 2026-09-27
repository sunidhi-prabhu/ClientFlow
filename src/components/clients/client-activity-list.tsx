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

const timeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

function describe(item: ClientActivityItem): string {
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
  if (items.length === 0) {
    return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  }
  return (
    <ol className="relative grid gap-4 border-l pl-4">
      {items.map((item) => (
        <li key={item.id} className="relative">
          <span
            aria-hidden
            className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-primary"
          />
          <p className="text-sm">
            <span className="font-medium">{item.actor?.name ?? "A former member"}</span>{" "}
            {describe(item)}
          </p>
          <time dateTime={item.createdAt.toISOString()} className="text-xs text-muted-foreground">
            {timeFormat.format(item.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}
