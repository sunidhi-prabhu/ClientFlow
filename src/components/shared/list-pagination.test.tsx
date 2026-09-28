// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ListPagination } from "./list-pagination";

afterEach(cleanup);

describe("ListPagination", () => {
  const href = (page: number) => `/list?page=${page}`;

  it("shows the exact total by default", () => {
    render(<ListPagination page={2} pageCount={4} pageSize={25} total={90} hrefForPage={href} />);
    expect(screen.getByRole("navigation", { name: "Pagination" })).toHaveTextContent(
      "Showing 26–50 of 90",
    );
  });

  it("can label a total that is only a lower bound (capped count)", () => {
    render(
      <ListPagination
        page={400}
        pageCount={400}
        pageSize={25}
        total={10_000}
        totalLabel="10,000+"
        hrefForPage={href}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Pagination" });
    expect(nav).toHaveTextContent("Showing 9976–10000 of 10,000+");
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/list?page=399",
    );
  });
});
