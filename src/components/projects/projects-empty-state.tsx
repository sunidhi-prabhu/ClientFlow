import { FolderKanban, SearchX } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/shared/empty-state";
import { buttonVariants } from "@/components/ui/button";

export function ProjectsEmptyState({
  filtered,
  basePath,
  canCreate,
}: {
  filtered: boolean;
  basePath: string;
  canCreate: boolean;
}) {
  if (filtered) {
    return (
      <EmptyState
        icon={SearchX}
        title="No matching projects"
        description="Try a different search, status or client filter."
        action={
          <Link href={basePath} className={buttonVariants({ variant: "outline" })}>
            Clear filters
          </Link>
        }
      />
    );
  }
  return (
    <EmptyState
      icon={FolderKanban}
      title="No projects yet"
      description={
        canCreate
          ? "Create a project to track its status, dates, progress and team."
          : "Projects created by your team will appear here."
      }
      action={
        canCreate && (
          <Link href={`${basePath}/new`} className={buttonVariants()}>
            New project
          </Link>
        )
      }
    />
  );
}
