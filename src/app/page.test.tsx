// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getSession } from "@/server/auth/session";
import { listUserOrganizations } from "@/server/tenancy/memberships";

import HomePage from "./page";

vi.mock("@/server/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/server/tenancy/memberships", () => ({ listUserOrganizations: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

type Session = Awaited<ReturnType<typeof getSession>>;
const session = { user: { id: "user_1" }, session: { id: "session_1" } } as unknown as Session;

beforeEach(() => {
  vi.mocked(getSession).mockReset();
  vi.mocked(listUserOrganizations).mockReset();
});
afterEach(cleanup);

describe("HomePage (/)", () => {
  it("shows the landing page to visitors who are not signed in", async () => {
    vi.mocked(getSession).mockResolvedValue(null);
    render(await HomePage());
    expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Sign in" })[0]).toHaveAttribute("href", "/sign-in");
    expect(listUserOrganizations).not.toHaveBeenCalled();
  });

  it("redirects a signed-in user to their first organization", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(listUserOrganizations).mockResolvedValue([
      { slug: "acme" },
      { slug: "globex" },
    ] as Awaited<ReturnType<typeof listUserOrganizations>>);
    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /o/acme");
    expect(listUserOrganizations).toHaveBeenCalledWith("user_1");
  });

  it("redirects a signed-in user without an organization to onboarding", async () => {
    vi.mocked(getSession).mockResolvedValue(session);
    vi.mocked(listUserOrganizations).mockResolvedValue([]);
    await expect(HomePage()).rejects.toThrow("NEXT_REDIRECT /onboarding");
  });
});
