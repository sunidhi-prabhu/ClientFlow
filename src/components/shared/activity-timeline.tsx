export type TimelineItem = {
  id: string;
  /** null when the acting user no longer exists. */
  actorName: string | null;
  /** What happened, after the actor's name (e.g. "archived this client"). */
  description: string;
  createdAt: Date;
};

const timeFormat = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** Vertical activity history (most recent first), shared by entity detail pages. */
export function ActivityTimeline({ items }: { items: TimelineItem[] }) {
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
