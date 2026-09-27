import { redirect } from "next/navigation";

import { getSession } from "@/server/auth/session";
import { listUserOrganizations } from "@/server/tenancy/memberships";

/** Entry point: send visitors to sign-in, onboarding, or their first organization. */
export default async function HomePage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const [first] = await listUserOrganizations(session.user.id);
  redirect(first ? `/o/${first.slug}` : "/onboarding");
}
