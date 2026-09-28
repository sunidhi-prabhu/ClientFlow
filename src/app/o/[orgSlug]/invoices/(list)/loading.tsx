import { Skeleton } from "@/components/ui/skeleton";

export default function InvoicesLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading invoices">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="flex flex-col gap-2 lg:flex-row">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 lg:w-48" />
        <Skeleton className="h-8 lg:w-48" />
        <Skeleton className="h-8 lg:w-44" />
      </div>
      <div className="grid gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
