// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NavLinks } from "@/components/layout/nav-links";

vi.mock("next/navigation", () => ({ usePathname: () => "/o/acme" }));

describe("NavLinks permissions", () => {
  afterEach(cleanup);

  it("shows Invoices to roles with invoice:read", () => {
    render(<NavLinks orientation="vertical" basePath="/o/acme" role="MANAGER" />);
    expect(screen.getByRole("link", { name: "Invoices" })).toHaveAttribute(
      "href",
      "/o/acme/invoices",
    );
  });

  it("hides Invoices from MEMBER (the page denies access too)", () => {
    render(<NavLinks orientation="vertical" basePath="/o/acme" role="MEMBER" />);
    expect(screen.queryByRole("link", { name: "Invoices" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Projects" })).toBeInTheDocument();
  });
});
