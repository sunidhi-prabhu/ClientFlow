import { Skeleton } from "@/components/ui/skeleton";

export default function ClientsLoading() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading clients">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-20" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Skeleton className="h-8 flex-1" />
        <Skeleton className="h-8 sm:w-48" />
        <Skeleton className="h-8 sm:w-44" />
      </div>
      <div className="grid gap-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    </div>
  );
}
