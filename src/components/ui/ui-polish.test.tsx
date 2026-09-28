// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import NotFound from "@/app/not-found";
import { NavLinks } from "@/components/layout/nav-links";

import { buttonVariants } from "./button";

const pathname = vi.hoisted(() => ({ current: "/o/acme/invoices" }));
vi.mock("next/navigation", () => ({ usePathname: () => pathname.current }));

afterEach(cleanup);

describe("buttonVariants for links styled as buttons", () => {
  it("merges conflicting classes so outline links get their border", () => {
    const classes = buttonVariants({ variant: "outline" }).split(" ");
    expect(classes).toContain("border-border");
    expect(classes).not.toContain("border-transparent");
  });

  it("keeps extra classes", () => {
    expect(buttonVariants({ variant: "ghost", className: "w-full" })).toContain("w-full");
  });
});

describe("NotFound", () => {
  it("is a main landmark with a real link (not a link posing as a button)", () => {
    render(<NotFound />);
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to overview" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("NavLinks on phones (horizontal)", () => {
  it("scrolls the current page's item into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<NavLinks orientation="horizontal" basePath="/o/acme" role="OWNER" />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.contexts[0]).toBe(screen.getByRole("link", { name: "Invoices" }));
  });

  it("does not scroll the vertical sidebar", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(<NavLinks orientation="vertical" basePath="/o/acme" role="OWNER" />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
