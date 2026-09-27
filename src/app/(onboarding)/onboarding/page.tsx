import { type Metadata } from "next";

import { CreateOrganizationForm } from "./create-organization-form";

export const metadata: Metadata = { title: "Create an organization" };

export default function OnboardingPage() {
  return (
    <>
      <div className="mb-6 space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">Create an organization</h1>
        <p className="text-sm text-muted-foreground">
          Your clients, projects and invoices live in an organization. You&apos;ll be its owner and
          can invite your team later.
        </p>
      </div>
      <CreateOrganizationForm />
    </>
  );
}
