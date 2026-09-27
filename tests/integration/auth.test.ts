import { describe, expect, it } from "vitest";

import { getDb } from "@/lib/db";

import {
  authFetch,
  BASE_URL,
  createVerifiedUser,
  getSessionFor,
  PASSWORD,
  sessionCookie,
  signIn,
  signUp,
  verifyEmail,
} from "./support/auth";
import { emailsTo, latestResetToken, latestVerificationCode, outbox } from "./support/outbox";

const EMAIL = "ada@example.com";

/** All verification rows, to assert secrets are not stored in plain text. */
async function verificationRows() {
  return getDb().verification.findMany();
}

async function expireAllVerifications() {
  await getDb().verification.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
}

describe("sign-up", () => {
  it("creates an unverified user, emails a code, and starts no session", async () => {
    const response = await signUp(EMAIL);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.user).toMatchObject({ email: EMAIL, emailVerified: false });
    expect(sessionCookie(response)).toBeUndefined();
    await expect(getDb().session.count()).resolves.toBe(0);

    const code = latestVerificationCode(EMAIL);
    expect(JSON.stringify(body)).not.toContain(code);
  });

  it("stores the password as a hash, never in plain text", async () => {
    await signUp(EMAIL);
    const account = await getDb().account.findFirstOrThrow({ where: { providerId: "credential" } });
    expect(account.password).toBeTruthy();
    expect(account.password).not.toContain(PASSWORD);
  });

  it("rejects passwords shorter than 10 characters", async () => {
    const response = await signUp(EMAIL, "short-pw");
    expect(response.status).toBe(400);
    await expect(getDb().user.count()).resolves.toBe(0);
  });

  it("duplicate sign-up does not create a second account or reveal that the email exists", async () => {
    const first = await signUp(EMAIL);
    const firstBody = await first.json();
    outbox.length = 0;

    const duplicate = await signUp(EMAIL, "another-password-123", "Impostor");
    const duplicateBody = await duplicate.json();

    expect(duplicate.status).toBe(first.status);
    expect(Object.keys(duplicateBody)).toEqual(Object.keys(firstBody));
    expect(Object.keys(duplicateBody.user).sort()).toEqual(Object.keys(firstBody.user).sort());
    await expect(getDb().user.count()).resolves.toBe(1);
    // The real owner is told; no verification code is issued to the caller.
    expect(emailsTo(EMAIL, "existing-account")).toHaveLength(1);
    expect(emailsTo(EMAIL, "verification-code")).toHaveLength(0);
    // The original password still works after verification.
    await verifyEmail(EMAIL, (await createCodeFor(EMAIL)) ?? "");
    expect((await signIn(EMAIL)).status).toBe(200);
  });
});

/** Request a fresh verification code for an existing unverified user. */
async function createCodeFor(email: string) {
  await authFetch("/email-otp/send-verification-otp", {
    body: { email, type: "email-verification" },
  });
  return latestVerificationCode(email);
}

describe("email verification", () => {
  it("verifies with the emailed code and signs the user in", async () => {
    await signUp(EMAIL);
    const response = await verifyEmail(EMAIL, latestVerificationCode(EMAIL));

    expect(response.status).toBe(200);
    const cookie = sessionCookie(response);
    expect(cookie).toBeDefined();
    await expect(getDb().user.findUnique({ where: { email: EMAIL } })).resolves.toMatchObject({
      emailVerified: true,
    });
    await expect(getSessionFor(cookie!)).resolves.toMatchObject({ user: { email: EMAIL } });
  });

  it("stores codes server-side, hashed", async () => {
    await signUp(EMAIL);
    const code = latestVerificationCode(EMAIL);
    const rows = await verificationRows();

    expect(rows).toHaveLength(1);
    expect(rows[0].expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(JSON.stringify(rows)).not.toContain(code);
    expect(JSON.stringify(rows)).not.toContain(EMAIL);
  });

  it("a code cannot be used twice", async () => {
    await signUp(EMAIL);
    const code = latestVerificationCode(EMAIL);
    expect((await verifyEmail(EMAIL, code)).status).toBe(200);

    const reuse = await verifyEmail(EMAIL, code);
    expect(reuse.status).toBe(400);
    expect(sessionCookie(reuse)).toBeUndefined();
    await expect(verificationRows()).resolves.toHaveLength(0);
  });

  it("an expired code is rejected and the user stays unverified", async () => {
    await signUp(EMAIL);
    const code = latestVerificationCode(EMAIL);
    await expireAllVerifications();

    const response = await verifyEmail(EMAIL, code);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("OTP_EXPIRED");
    await expect(getDb().user.findUnique({ where: { email: EMAIL } })).resolves.toMatchObject({
      emailVerified: false,
    });
  });

  it("a wrong code is rejected and repeated guessing burns the code", async () => {
    await signUp(EMAIL);
    const code = latestVerificationCode(EMAIL);
    const wrong = code === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await verifyEmail(EMAIL, wrong)).status).toBe(400);
    }
    const locked = await verifyEmail(EMAIL, code);
    expect(locked.status).toBe(403);
    expect((await locked.json()).code).toBe("TOO_MANY_ATTEMPTS");
  });
});

describe("sign-in", () => {
  it("is refused until the email is verified", async () => {
    await signUp(EMAIL);
    const response = await signIn(EMAIL);
    expect(response.status).toBe(403);
    expect((await response.json()).code).toBe("EMAIL_NOT_VERIFIED");
    expect(sessionCookie(response)).toBeUndefined();
  });

  it("succeeds with the correct password and sets an HttpOnly session cookie", async () => {
    await createVerifiedUser(EMAIL);
    const response = await signIn(EMAIL);

    expect(response.status).toBe(200);
    const setCookie = response.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("better-auth.session_token="));
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
    await expect(getSessionFor(sessionCookie(response)!)).resolves.toMatchObject({
      user: { email: EMAIL },
    });
  });

  it("rejects an incorrect password exactly like an unknown email", async () => {
    await createVerifiedUser(EMAIL);
    const wrongPassword = await signIn(EMAIL, "not-the-password");
    const unknownEmail = await signIn("nobody@example.com", "not-the-password");

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(await wrongPassword.json()).toEqual(await unknownEmail.json());
    expect(sessionCookie(wrongPassword)).toBeUndefined();
  });
});

describe("sessions", () => {
  it("are stored server-side with an expiry", async () => {
    const { userId } = await createVerifiedUser(EMAIL);
    const session = await getDb().session.findFirstOrThrow({ where: { userId } });
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    expect(session.expiresAt.getTime() - Date.now()).toBeGreaterThan(sevenDays - 60_000);
    expect(session.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(sevenDays);
  });

  it("sign-out deletes the session so the cookie stops working", async () => {
    const { userId, cookie } = await createVerifiedUser(EMAIL);
    const response = await authFetch("/sign-out", { cookie });

    expect(response.status).toBe(200);
    await expect(getDb().session.count({ where: { userId } })).resolves.toBe(0);
    await expect(getSessionFor(cookie)).resolves.toBeNull();
  });

  it("an expired session is rejected", async () => {
    const { userId, cookie } = await createVerifiedUser(EMAIL);
    await getDb().session.updateMany({
      where: { userId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await expect(getSessionFor(cookie)).resolves.toBeNull();
  });

  it("a forged or tampered cookie is rejected", async () => {
    const { cookie } = await createVerifiedUser(EMAIL);
    const [name, value] = cookie.split("=");
    await expect(getSessionFor(`${name}=${value.slice(0, -2)}xx`)).resolves.toBeNull();
    await expect(getSessionFor(`${name}=not-a-real-token`)).resolves.toBeNull();
  });
});

describe("password reset", () => {
  const requestReset = (email: string) =>
    authFetch("/request-password-reset", { body: { email, redirectTo: "/reset-password" } });
  const resetPassword = (token: string, newPassword: string) =>
    authFetch("/reset-password", { body: { token, newPassword } });

  it("does not reveal whether an email address is registered", async () => {
    await createVerifiedUser(EMAIL);
    outbox.length = 0;

    const known = await requestReset(EMAIL);
    const unknown = await requestReset("nobody@example.com");

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
    expect(emailsTo("nobody@example.com")).toHaveLength(0);
    expect(emailsTo(EMAIL, "password-reset")).toHaveLength(1);
  });

  it("resets the password with the emailed token and revokes existing sessions", async () => {
    const { userId, cookie } = await createVerifiedUser(EMAIL);
    await requestReset(EMAIL);
    const token = latestResetToken(EMAIL);

    // The emailed link validates the token, then redirects to our reset page.
    const link = await authFetch(`/reset-password/${token}?callbackURL=%2Freset-password`, {
      method: "GET",
    });
    expect(link.status).toBe(302);
    expect(link.headers.get("location")).toBe(`${BASE_URL}/reset-password?token=${token}`);

    const response = await resetPassword(token, "brand-new-password-42");
    expect(response.status).toBe(200);

    await expect(getSessionFor(cookie)).resolves.toBeNull();
    await expect(getDb().session.count({ where: { userId } })).resolves.toBe(0);
    expect((await signIn(EMAIL, PASSWORD)).status).toBe(401);
    expect((await signIn(EMAIL, "brand-new-password-42")).status).toBe(200);
  });

  it("stores reset tokens hashed and never returns them", async () => {
    await createVerifiedUser(EMAIL);
    const response = await requestReset(EMAIL);
    const token = latestResetToken(EMAIL);

    expect(await response.text()).not.toContain(token);
    expect(JSON.stringify(await verificationRows())).not.toContain(token);
  });

  it("a reset token is single-use", async () => {
    await createVerifiedUser(EMAIL);
    await requestReset(EMAIL);
    const token = latestResetToken(EMAIL);

    expect((await resetPassword(token, "brand-new-password-42")).status).toBe(200);
    const reuse = await resetPassword(token, "attacker-password-99");
    expect(reuse.status).toBe(400);
    expect((await signIn(EMAIL, "attacker-password-99")).status).toBe(401);
  });

  it("an expired reset token is rejected and the password is unchanged", async () => {
    await createVerifiedUser(EMAIL);
    await requestReset(EMAIL);
    const token = latestResetToken(EMAIL);
    await expireAllVerifications();

    const response = await resetPassword(token, "brand-new-password-42");
    expect(response.status).toBe(400);
    expect((await signIn(EMAIL, PASSWORD)).status).toBe(200);
  });
});

describe("Google OAuth", () => {
  it("uses the standard provider: redirects to Google with our client id and state", async () => {
    const response = await authFetch("/sign-in/social", {
      body: { provider: "google", callbackURL: "/" },
    });
    const body = await response.json();
    const url = new URL(body.url);

    expect(response.status).toBe(200);
    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.searchParams.get("client_id")).toBe(
      "test-google-client-id.apps.googleusercontent.com",
    );
    expect(url.searchParams.get("redirect_uri")).toBe(`${BASE_URL}/api/auth/callback/google`);
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(body.url).not.toContain("test-google-client-secret");
  });
});

describe("unused endpoints", () => {
  it.each([
    "/sign-in/email-otp",
    "/email-otp/request-password-reset",
    "/email-otp/reset-password",
    "/forget-password/email-otp",
    "/email-otp/check-verification-otp",
  ])("%s is disabled", async (path) => {
    const response = await authFetch(path, { body: { email: EMAIL, otp: "123456" } });
    expect(response.status).toBe(404);
  });
});

describe("account-management endpoints", () => {
  it("change-password requires the current password and leaves sessions untouched on failure", async () => {
    const { cookie } = await createVerifiedUser(EMAIL);
    const other = sessionCookie(await signIn(EMAIL))!;

    const response = await authFetch("/change-password", {
      cookie,
      body: { currentPassword: "not-the-password", newPassword: "brand-new-password-42" },
    });

    expect(response.status).toBe(400);
    await expect(getSessionFor(cookie)).resolves.not.toBeNull();
    await expect(getSessionFor(other)).resolves.not.toBeNull();
    expect((await signIn(EMAIL, PASSWORD)).status).toBe(200);
  });

  it("change-password always revokes every other session, even if the client opts out", async () => {
    const { userId, cookie } = await createVerifiedUser(EMAIL);
    const otherDevice = sessionCookie(await signIn(EMAIL))!;
    expect(await getDb().session.count({ where: { userId } })).toBe(2);

    const response = await authFetch("/change-password", {
      cookie,
      body: {
        currentPassword: PASSWORD,
        newPassword: "brand-new-password-42",
        revokeOtherSessions: false,
      },
    });

    expect(response.status).toBe(200);
    // Every earlier session is gone, including the old cookie of the caller…
    await expect(getSessionFor(otherDevice)).resolves.toBeNull();
    await expect(getSessionFor(cookie)).resolves.toBeNull();
    // …and the caller is issued a fresh session cookie.
    const fresh = sessionCookie(response);
    expect(fresh).toBeDefined();
    await expect(getSessionFor(fresh!)).resolves.toMatchObject({ user: { email: EMAIL } });
    expect(await getDb().session.count({ where: { userId } })).toBe(1);
    expect((await signIn(EMAIL, "brand-new-password-42")).status).toBe(200);
  });

  it("update-user can change the name but not the email or its verification status", async () => {
    const { userId, cookie } = await createVerifiedUser(EMAIL);

    expect((await authFetch("/update-user", { cookie, body: { name: "Ada L." } })).status).toBe(
      200,
    );
    expect(
      (await authFetch("/update-user", { cookie, body: { email: "mallory@example.com" } })).status,
    ).toBe(400);
    await authFetch("/update-user", { cookie, body: { name: "Ada", emailVerified: false } });

    await expect(getDb().user.findUnique({ where: { id: userId } })).resolves.toMatchObject({
      name: "Ada",
      email: EMAIL,
      emailVerified: true,
    });
  });

  it("list-sessions returns only the caller's sessions, and listed tokens are not usable as cookies", async () => {
    const { cookie } = await createVerifiedUser(EMAIL);
    await createVerifiedUser("grace@example.com");

    const response = await authFetch("/list-sessions", { method: "GET", cookie });
    const sessions = (await response.json()) as { token: string; userId: string }[];
    const user = await getDb().user.findUniqueOrThrow({ where: { email: EMAIL } });

    expect(response.status).toBe(200);
    expect(sessions.map((session) => session.userId)).toEqual([user.id]);
    // The cookie must carry a signature made with BETTER_AUTH_SECRET.
    await expect(
      getSessionFor(`better-auth.session_token=${sessions[0].token}`),
    ).resolves.toBeNull();
  });

  it("revoke-session revokes the caller's own sessions but not another user's", async () => {
    const { cookie } = await createVerifiedUser(EMAIL);
    const otherDevice = sessionCookie(await signIn(EMAIL))!;
    const grace = await createVerifiedUser("grace@example.com");
    const graceSession = await getDb().session.findFirstOrThrow({
      where: { userId: grace.userId },
    });
    const ownSessions = await getDb().session.findMany({
      where: { user: { email: EMAIL } },
      orderBy: { createdAt: "asc" },
    });

    await authFetch("/revoke-session", { cookie, body: { token: graceSession.token } });
    await expect(getSessionFor(grace.cookie)).resolves.not.toBeNull();

    await authFetch("/revoke-session", { cookie, body: { token: ownSessions[1].token } });
    await expect(getSessionFor(otherDevice)).resolves.toBeNull();
    await expect(getSessionFor(cookie)).resolves.not.toBeNull();
  });

  it("changing the email and deleting the account are not available", async () => {
    const { userId, cookie } = await createVerifiedUser(EMAIL);
    const changeEmail = await authFetch("/change-email", {
      cookie,
      body: { newEmail: "new@example.com" },
    });
    const deleteUser = await authFetch("/delete-user", { cookie, body: { password: PASSWORD } });

    expect(changeEmail.status).toBe(400);
    expect(deleteUser.status).toBe(404);
    await expect(getDb().user.findUnique({ where: { id: userId } })).resolves.toMatchObject({
      email: EMAIL,
    });
  });

  it.each([
    ["GET", "/verify-email?token=anything"],
    ["POST", "/send-verification-email"],
    ["POST", "/verify-password"],
    ["POST", "/get-access-token"],
    ["POST", "/refresh-token"],
    ["GET", "/account-info"],
  ])("%s %s is disabled", async (method, path) => {
    const { cookie } = await createVerifiedUser(EMAIL);
    const response = await authFetch(path, {
      method,
      cookie,
      body:
        method === "POST" ? { email: EMAIL, password: PASSWORD, providerId: "google" } : undefined,
    });
    expect(response.status).toBe(404);
  });
});
