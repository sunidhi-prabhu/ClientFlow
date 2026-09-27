"use client";

import { SegmentError } from "@/components/shared/segment-error";

export default function ProjectsError(props: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <SegmentError title="Projects could not be loaded" {...props} />;
}
