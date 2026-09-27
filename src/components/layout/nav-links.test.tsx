// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NavLinks } from "@/components/layout/nav-links";

const pathname = vi.hoisted(() => ({ current: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

describe("NavLinks", () => {
  afterEach(cleanup);

  it("marks the current route as active", () => {
    pathname.current = "/o/acme";
    render(<NavLinks orientation="vertical" basePath="/o/acme" />);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
  });

  it("does not mark the root link active on other routes", () => {
    pathname.current = "/o/acme/clients";
    render(<NavLinks orientation="vertical" basePath="/o/acme" />);
    expect(screen.getByRole("link", { name: "Overview" })).not.toHaveAttribute("aria-current");
  });

  it("links within the current organization", () => {
    pathname.current = "/o/acme";
    render(<NavLinks orientation="vertical" basePath="/o/acme" />);
    expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/o/acme");
  });
});
