// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import AuthLayout from "./layout";

afterEach(cleanup);

describe("AuthLayout", () => {
  it("renders the page in the main landmark with the logo", () => {
    render(
      <AuthLayout params={Promise.resolve({})}>
        <h1>Sign in to ClientFlow</h1>
      </AuthLayout>,
    );
    const main = screen.getByRole("main");
    expect(main).toContainElement(screen.getByRole("heading", { name: "Sign in to ClientFlow" }));
    expect(main).toContainElement(screen.getByRole("link", { name: "ClientFlow" }));
  });

  it("shows the walkthrough beside the form only on large screens", () => {
    const { container } = render(
      <AuthLayout params={Promise.resolve({})}>
        <p>form</p>
      </AuthLayout>,
    );
    expect(container.firstChild).toHaveClass("grid", "lg:grid-cols-2");
    const showcase = screen.getByRole("complementary", { name: "How ClientFlow works" });
    expect(showcase).toHaveClass("hidden", "lg:flex");
    expect(showcase.compareDocumentPosition(screen.getByRole("main"))).toBe(
      Node.DOCUMENT_POSITION_PRECEDING,
    );
  });
});
