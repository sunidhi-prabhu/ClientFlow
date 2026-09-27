import { LayoutDashboard, type LucideIcon } from "lucide-react";

export type NavItem = {
  title: string;
  href: string;
  icon: LucideIcon;
};

/**
 * Primary navigation. Add an entry here when a feature's route ships;
 * never list routes that do not exist yet.
 */
export const mainNavigation: NavItem[] = [{ title: "Overview", href: "/", icon: LayoutDashboard }];
