"use client";

import { SegmentError } from "@/components/shared/segment-error";

export default function OverviewError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <SegmentError title="The overview could not be loaded" {...props} />;
}
