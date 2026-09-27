import { type Metadata } from "next";
import Link from "next/link";

import { AuthHeading } from "../auth-heading";
import { ResetPasswordForm } from "./reset-password-form";

export const metadata: Metadata = { title: "Set a new password" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const { token, error } = await searchParams;

  if (error || typeof token !== "string" || !token) {
    return (
      <>
        <AuthHeading title="Link expired">
          This reset link is invalid, expired or already used.
        </AuthHeading>
        <Link
          href="/forgot-password"
          className="block text-center text-sm font-medium hover:underline"
        >
          Request a new link
        </Link>
      </>
    );
  }

  return (
    <>
      <AuthHeading title="Set a new password" />
      <ResetPasswordForm token={token} />
    </>
  );
}
