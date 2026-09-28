"use client";

import { SegmentError } from "@/components/shared/segment-error";

export default function InvoicesError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <SegmentError title="Invoices could not be loaded" {...props} />;
}
