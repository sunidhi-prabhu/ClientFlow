// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LandingPage } from "./landing-page";

afterEach(cleanup);

describe("LandingPage", () => {
  it("introduces ClientFlow in the hero", () => {
    render(<LandingPage />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Your clients, projects and invoices, finally in one place",
    );
    expect(screen.getByText(/for freelancers and small teams/i, { selector: "p" })).toBeVisible();
    expect(screen.getByRole("link", { name: "ClientFlow" })).toHaveAttribute("href", "/");
  });

  it("links every Sign in action to the sign-in flow", () => {
    render(<LandingPage />);
    const signIn = [
      ...screen.getAllByRole("link", { name: "Sign in" }),
      screen.getByRole("link", { name: "I already have an account" }),
    ];
    expect(signIn).toHaveLength(3);
    for (const link of signIn) expect(link).toHaveAttribute("href", "/sign-in");
  });

  it("links every Create account action to the sign-up flow", () => {
    render(<LandingPage />);
    const signUp = [
      ...screen.getAllByRole("link", { name: "Create account" }),
      screen.getByRole("link", { name: "Get started" }),
    ];
    expect(signUp).toHaveLength(3);
    for (const link of signUp) expect(link).toHaveAttribute("href", "/sign-up");
  });

  it("keeps both account actions in the header", () => {
    render(<LandingPage />);
    const nav = screen.getByRole("navigation", { name: "Account" });
    expect(within(nav).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(within(nav).getByRole("link", { name: "Create account" })).toHaveAttribute(
      "href",
      "/sign-up",
    );
  });

  it("lists the main capabilities", () => {
    render(<LandingPage />);
    const features = within(screen.getByRole("list", { name: "Features" }));
    const titles = features.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual([
      "Clients",
      "Projects",
      "Tasks",
      "Invoices",
      "Dashboard & activity",
      "Audit log",
    ]);
    expect(features.getByText(/Kanban board/)).toBeVisible();
  });

  it("explains the value of keeping everything in one place", () => {
    render(<LandingPage />);
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Stay organized from first contact to final payment",
      }),
    ).toBeVisible();
    expect(screen.getByText(/One place for clients, projects, tasks and billing/)).toBeVisible();
  });

  it("has landmarks and a single h1", () => {
    render(<LandingPage />);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBeInTheDocument();
    expect(screen.getByRole("contentinfo")).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByTestId("board-illustration")).toHaveAttribute("aria-hidden");
  });

  it("stacks on mobile and widens into columns on larger screens", () => {
    render(<LandingPage />);
    const grid = screen.getByRole("list", { name: "Features" });
    expect(grid).toHaveClass("grid-cols-1", "sm:grid-cols-2", "lg:grid-cols-3");
    const heroActions = screen.getAllByRole("link", { name: "Create account" })[1].parentElement;
    expect(heroActions).toHaveClass("flex-col", "sm:flex-row");
  });
});
