"use client";

import { ArchiveButton, type ArchiveAction } from "@/components/shared/archive-button";

/** Archive or restore a client (see ArchiveButton). */
export function ClientArchiveButton({
  clientId,
  ...props
}: {
  organizationSlug: string;
  clientId: string;
  archived: boolean;
  archiveAction: ArchiveAction;
  restoreAction: ArchiveAction;
}) {
  return <ArchiveButton id={clientId} {...props} />;
}
