import { FolderKanban, LayoutDashboard, type LucideIcon, Receipt, Users } from "lucide-react";

import { type Permission } from "@/lib/permissions";

export type NavItem = {
  title: string;
  /** Path inside the organization, appended to `/o/[orgSlug]` ("" = its home). */
  href: string;
  icon: LucideIcon;
  /** Hide the item from roles without this permission (the page checks it too). */
  permission?: Permission;
};

/**
 * Primary navigation within an organization. Add an entry here when a
 * feature's route ships; never list routes that do not exist yet.
 */
export const mainNavigation: NavItem[] = [
  { title: "Overview", href: "", icon: LayoutDashboard },
  { title: "Clients", href: "/clients", icon: Users },
  { title: "Projects", href: "/projects", icon: FolderKanban },
  { title: "Invoices", href: "/invoices", icon: Receipt, permission: "invoice:read" },
];
