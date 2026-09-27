import { LayoutDashboard, type LucideIcon, Users } from "lucide-react";

export type NavItem = {
  title: string;
  /** Path inside the organization, appended to `/o/[orgSlug]` ("" = its home). */
  href: string;
  icon: LucideIcon;
};

/**
 * Primary navigation within an organization. Add an entry here when a
 * feature's route ships; never list routes that do not exist yet.
 */
export const mainNavigation: NavItem[] = [
  { title: "Overview", href: "", icon: LayoutDashboard },
  { title: "Clients", href: "/clients", icon: Users },
];
