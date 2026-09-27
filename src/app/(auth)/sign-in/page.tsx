import { type Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { isGoogleSignInEnabled } from "@/server/auth/auth";
import { getSession } from "@/server/auth/session";

import { AuthHeading } from "../auth-heading";
import { Divider, GoogleButton } from "../google-button";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  if (await getSession()) redirect("/");
  const { reset, error } = await searchParams;

  return (
    <>
      <AuthHeading title="Sign in to ClientFlow" />
      {reset === "1" && (
        <p className="mb-4 rounded-lg bg-muted px-3 py-2 text-sm">
          Your password was changed. Sign in with your new password.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mb-4 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          Sign-in failed. Please try again.
        </p>
      )}
      {isGoogleSignInEnabled() && (
        <>
          <GoogleButton />
          <Divider />
        </>
      )}
      <SignInForm />
      <p className="mt-6 text-center text-sm text-muted-foreground">
        New to ClientFlow?{" "}
        <Link href="/sign-up" className="font-medium text-foreground hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
