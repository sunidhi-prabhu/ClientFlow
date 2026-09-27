"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Error state for a route segment's error.tsx (message only; details stay in logs). */
export function SegmentError({
  title,
  error,
  retry,
}: {
  title: string;
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-16 text-center"
    >
      <AlertTriangle className="size-6 text-destructive" aria-hidden />
      <div className="space-y-1">
        <h1 className="font-medium">{title}</h1>
        <p className="text-sm text-muted-foreground">
          Something went wrong on our side. Please try again.
          {error.digest && (
            <span className="mt-1 block font-mono text-xs">Ref: {error.digest}</span>
          )}
        </p>
      </div>
      <Button onClick={() => retry()}>Try again</Button>
    </div>
  );
}
