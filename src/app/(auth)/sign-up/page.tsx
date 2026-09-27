import { type Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { isGoogleSignInEnabled } from "@/server/auth/auth";
import { getSession } from "@/server/auth/session";

import { AuthHeading } from "../auth-heading";
import { Divider, GoogleButton } from "../google-button";
import { SignUpForm } from "./sign-up-form";

export const metadata: Metadata = { title: "Create account" };

export default async function SignUpPage() {
  if (await getSession()) redirect("/");
  return (
    <>
      <AuthHeading title="Create your account">
        We&apos;ll email you a code to confirm your address.
      </AuthHeading>
      {isGoogleSignInEnabled() && (
        <>
          <GoogleButton />
          <Divider />
        </>
      )}
      <SignUpForm />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/sign-in" className="font-medium text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
