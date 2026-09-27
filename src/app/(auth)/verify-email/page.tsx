import { type Metadata } from "next";
import Link from "next/link";

import { AuthHeading } from "../auth-heading";
import { VerifyEmailForm } from "./verify-email-form";

export const metadata: Metadata = { title: "Verify email" };

export default async function VerifyEmailPage({ searchParams }: PageProps<"/verify-email">) {
  const { email, resend } = await searchParams;
  const address = typeof email === "string" ? email : "";

  if (!address) {
    return (
      <AuthHeading title="Verify your email">
        <Link href="/sign-in" className="underline">
          Sign in
        </Link>{" "}
        with your email and password to receive a new verification code.
      </AuthHeading>
    );
  }

  return (
    <>
      <AuthHeading title="Check your email">
        If <span className="font-medium text-foreground">{address}</span> needs verifying, we sent
        it a 6-digit code. It expires in 10 minutes.
      </AuthHeading>
      <VerifyEmailForm email={address} resend={resend === "1"} />
    </>
  );
}
