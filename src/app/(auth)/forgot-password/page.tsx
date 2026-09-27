import { type Metadata } from "next";
import Link from "next/link";

import { AuthHeading } from "../auth-heading";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Forgot password" };

export default function ForgotPasswordPage() {
  return (
    <>
      <AuthHeading title="Reset your password">
        Enter your email and we&apos;ll send you a reset link.
      </AuthHeading>
      <ForgotPasswordForm />
      <p className="mt-6 text-center text-sm">
        <Link href="/sign-in" className="text-muted-foreground hover:text-foreground">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
