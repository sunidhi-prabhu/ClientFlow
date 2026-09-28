import Link from "next/link";

export type FeedItem = {
  id: string;
  /** null when the acting user no longer exists. */
  actorName: string | null;
  description: string;
  createdAt: Date;
  /** The client or project the event belongs to. */
  subject: { name: string; href: string };
};

const timeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** Organization-wide activity (most recent first), each item linked to its client or project. */
export function ActivityFeed({
  label,
  items,
  emptyText,
}: {
  label: string;
  items: FeedItem[];
  emptyText: string;
}) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  return (
    <ol aria-label={label} className="grid gap-3">
      {items.map((item) => (
        <li key={item.id} className="grid gap-0.5 border-l-2 border-muted pl-3">
          <Link
            href={item.subject.href}
            className="truncate text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
          >
            {item.subject.name}
          </Link>
          <p className="text-sm break-words">
            <span className="font-medium">{item.actorName ?? "A former member"}</span>{" "}
            {item.description}
          </p>
          <time dateTime={item.createdAt.toISOString()} className="text-xs text-muted-foreground">
            {timeFormat.format(item.createdAt)}
          </time>
        </li>
      ))}
    </ol>
  );
}
