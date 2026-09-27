// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ClientActivityList } from "./client-activity-list";
import { ClientsEmptyState } from "./clients-empty-state";
import { ClientsPagination } from "./clients-pagination";
import { ClientsTable } from "./clients-table";
import { clientsListHref } from "./clients-url";

afterEach(cleanup);

describe("clientsListHref", () => {
  it("omits default values and keeps the rest", () => {
    expect(clientsListHref("/o/acme/clients", {})).toBe("/o/acme/clients");
    expect(clientsListHref("/o/acme/clients", { status: "current", sort: "name", page: 1 })).toBe(
      "/o/acme/clients",
    );
    expect(
      clientsListHref("/o/acme/clients", {
        q: "a&b",
        status: "ARCHIVED",
        sort: "created",
        page: 3,
      }),
    ).toBe("/o/acme/clients?q=a%26b&status=ARCHIVED&sort=created&page=3");
  });
});

describe("ClientsTable", () => {
  it("links each client to its details page and shows its status", () => {
    render(
      <ClientsTable
        basePath="/o/acme/clients"
        clients={[
          {
            id: "c1",
            name: "Wayne Enterprises",
            company: "Wayne Corp",
            email: "bruce@wayne.com",
            phone: null,
            status: "ACTIVE",
            updatedAt: new Date("2026-01-02T00:00:00Z"),
          },
          {
            id: "c2",
            name: "Stark Industries",
            company: null,
            email: null,
            phone: "555",
            status: "INACTIVE",
            updatedAt: new Date("2026-01-01T00:00:00Z"),
          },
        ]}
      />,
    );
    const table = screen.getByRole("table");
    expect(within(table).getByRole("link", { name: "Wayne Enterprises" })).toHaveAttribute(
      "href",
      "/o/acme/clients/c1",
    );
    expect(within(table).getByText("Inactive")).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
  });
});

describe("ClientsEmptyState", () => {
  it("offers to add the first client when allowed", () => {
    render(<ClientsEmptyState filtered={false} basePath="/o/acme/clients" canCreate />);
    expect(screen.getByText("No clients yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add client" })).toHaveAttribute(
      "href",
      "/o/acme/clients/new",
    );
  });

  it("hides the add button for read-only roles", () => {
    render(<ClientsEmptyState filtered={false} basePath="/o/acme/clients" canCreate={false} />);
    expect(screen.queryByRole("link", { name: "Add client" })).not.toBeInTheDocument();
  });

  it("offers to clear filters when nothing matches", () => {
    render(<ClientsEmptyState filtered basePath="/o/acme/clients" canCreate />);
    expect(screen.getByText("No matching clients")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/o/acme/clients",
    );
  });
});

describe("ClientsPagination", () => {
  const props = { basePath: "/o/acme/clients", params: { q: "acme" }, pageSize: 20, total: 45 };

  it("shows the range and links to neighbouring pages, keeping the filters", () => {
    render(<ClientsPagination {...props} page={2} pageCount={3} />);
    expect(screen.getByRole("navigation", { name: "Pagination" })).toHaveTextContent(
      "Showing 21–40 of 45",
    );
    expect(screen.getByRole("link", { name: "Previous page" })).toHaveAttribute(
      "href",
      "/o/acme/clients?q=acme",
    );
    expect(screen.getByRole("link", { name: "Next page" })).toHaveAttribute(
      "href",
      "/o/acme/clients?q=acme&page=3",
    );
  });

  it("disables links at the ends", () => {
    render(<ClientsPagination {...props} page={1} pageCount={3} />);
    expect(screen.queryByRole("link", { name: "Previous page" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next page" })).toBeInTheDocument();
  });

  it("renders nothing without results", () => {
    const { container } = render(<ClientsPagination {...props} total={0} page={1} pageCount={1} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("ClientActivityList", () => {
  it("describes each change with the actor", () => {
    render(
      <ClientActivityList
        items={[
          {
            id: "a2",
            type: "UPDATED",
            changes: { name: { from: "a", to: "b" }, notes: { from: null, to: null } },
            createdAt: new Date("2026-01-02T10:00:00Z"),
            actor: { name: "Ada", email: "ada@example.com" },
          },
          {
            id: "a1",
            type: "CREATED",
            changes: null,
            createdAt: new Date("2026-01-01T10:00:00Z"),
            actor: null,
          },
        ]}
      />,
    );
    const items = screen.getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Ada updated name, notes");
    expect(items[1]).toHaveTextContent("A former member added this client");
  });

  it("has an empty state", () => {
    render(<ClientActivityList items={[]} />);
    expect(screen.getByText("No activity yet.")).toBeInTheDocument();
  });
});
