import { Badge } from "@/components/ui/badge";
import { type InvoiceDisplayStatus } from "@/lib/invoices";
import { cn } from "@/lib/utils";

export const INVOICE_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  DRAFT: "Draft",
  ISSUED: "Issued",
  OVERDUE: "Overdue",
  PAID: "Paid",
  CANCELLED: "Cancelled",
};

const STYLES: Record<InvoiceDisplayStatus, { badge: string; dot: string }> = {
  DRAFT: { badge: "bg-muted text-muted-foreground", dot: "bg-muted-foreground/60" },
  ISSUED: { badge: "bg-sky-500/10 text-sky-700 dark:text-sky-400", dot: "bg-sky-500" },
  OVERDUE: { badge: "bg-destructive/10 text-destructive", dot: "bg-destructive" },
  PAID: {
    badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
  },
  CANCELLED: {
    badge: "border-border bg-transparent text-muted-foreground line-through",
    dot: "bg-muted-foreground/60",
  },
};

export function InvoiceStatusBadge({ status }: { status: InvoiceDisplayStatus }) {
  return (
    <Badge variant="secondary" className={cn("gap-1.5", STYLES[status].badge)}>
      <span aria-hidden className={cn("size-1.5 rounded-full", STYLES[status].dot)} />
      {INVOICE_STATUS_LABELS[status]}
    </Badge>
  );
}

/** Payment status in words, for lists and the details page. */
export function paymentStatusLabel(status: InvoiceDisplayStatus): string {
  switch (status) {
    case "PAID":
      return "Paid";
    case "OVERDUE":
      return "Unpaid · overdue";
    case "ISSUED":
      return "Awaiting payment";
    case "DRAFT":
      return "Not issued";
    case "CANCELLED":
      return "Cancelled";
  }
}
