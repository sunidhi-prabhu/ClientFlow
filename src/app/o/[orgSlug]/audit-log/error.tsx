"use client";

import { SegmentError } from "@/components/shared/segment-error";

export default function AuditLogError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <SegmentError title="The audit log could not be loaded" {...props} />;
}
