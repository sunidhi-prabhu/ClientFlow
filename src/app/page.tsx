import { redirect } from "next/navigation";

import { LandingPage } from "@/components/landing/landing-page";
import { getSession } from "@/server/auth/session";
import { listUserOrganizations } from "@/server/tenancy/memberships";

/**
 * Entry point: visitors who are not signed in see the public introduction;
 * signed-in users go to their first organization (or onboarding).
 */
export default async function HomePage() {
  const session = await getSession();
  if (!session) return <LandingPage />;

  const [first] = await listUserOrganizations(session.user.id);
  redirect(first ? `/o/${first.slug}` : "/onboarding");
}
