// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { summarizeInvoices } from "@/lib/dashboard";

import { Dashboard, type DashboardData } from "./dashboard";

afterEach(cleanup);

const now = new Date("2026-09-28T10:00:00Z");
const basePath = "/o/acme";

const full: DashboardData = {
  clients: { total: 3, byStatus: { ACTIVE: 2, INACTIVE: 1, ARCHIVED: 4 } },
  projects: {
    active: 7,
    byStatus: { PLANNING: 1, ACTIVE: 7, ON_HOLD: 2, COMPLETED: 0, ARCHIVED: 0 },
    activeProjects: [
      {
        id: "p1",
        name: "Website redesign",
        status: "ACTIVE",
        progress: 40,
        dueDate: new Date("2026-09-01T00:00:00Z"),
        client: { id: "c1", name: "Wayne Enterprises" },
        openTasks: 3,
      },
      {
        id: "p2",
        name: "Mobile app",
        status: "ACTIVE",
        progress: 90,
        dueDate: null,
        client: null,
        openTasks: 1,
      },
    ],
  },
  tasks: { total: 10, open: 6, byStatus: { TODO: 3, IN_PROGRESS: 2, REVIEW: 1, DONE: 4 } },
  invoices: summarizeInvoices(
    [
      { status: "DRAFT", currency: "USD", count: 1, cents: 100 },
      { status: "ISSUED", currency: "USD", count: 2, cents: 150_000 },
      { status: "PAID", currency: "USD", count: 1, cents: 12_345 },
    ],
    [{ currency: "USD", count: 1, cents: 50_000 }],
  ),
  projectActivity: [
    {
      id: "a1",
      type: "TASK_STATUS_CHANGED",
      changes: { task: { title: "Wireframes" }, status: { from: "TODO", to: "REVIEW" } },
      createdAt: new Date("2026-09-27T09:00:00Z"),
      actor: { name: "Ada", email: "ada@example.com" },
      project: { id: "p1", name: "Website redesign" },
    },
  ],
  clientActivity: [
    {
      id: "b1",
      type: "CREATED",
      changes: null,
      createdAt: new Date("2026-09-26T09:00:00Z"),
      actor: null,
      client: { id: "c1", name: "Wayne Enterprises" },
    },
  ],
};

function renderDashboard(data: DashboardData, canCreate = true) {
  render(
    <Dashboard
      data={data}
      basePath={basePath}
      canCreateClient={canCreate}
      canCreateProject={canCreate}
      now={now}
    />,
  );
}

const metric = (title: string) =>
  screen.getByRole("heading", { level: 2, name: title }).closest("[data-slot=card]") as HTMLElement;

describe("Dashboard", () => {
  it("shows the headline metrics with exact money and links to the filtered lists", () => {
    renderDashboard(full);
    expect(metric("Total clients")).toHaveTextContent("3");
    expect(metric("Total clients")).toHaveTextContent("2 active · 1 inactive");
    expect(metric("Active projects")).toHaveTextContent("7");
    expect(metric("Open tasks")).toHaveTextContent("6");
    expect(metric("Open tasks")).toHaveTextContent("4 of 10 tasks done");
    expect(metric("Overdue invoices")).toHaveTextContent("1");
    expect(metric("Overdue invoices")).toHaveTextContent("$500.00 due");
    // Invoiced = issued (incl. overdue) + paid; the draft is excluded.
    expect(metric("Total invoiced")).toHaveTextContent("$1,623.45");
    expect(metric("Total invoiced")).toHaveTextContent("$1,500.00 outstanding");
    expect(metric("Total paid")).toHaveTextContent("$123.45");

    const links = within(screen.getByRole("region", { name: "Key metrics" })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual([
      "/o/acme/clients",
      "/o/acme/projects?status=ACTIVE",
      "/o/acme/invoices?status=OVERDUE",
      "/o/acme/invoices",
      "/o/acme/invoices?status=PAID",
    ]);
  });

  it("lists active project progress, flags overdue projects and notes hidden ones", () => {
    renderDashboard(full);
    const list = screen.getByRole("list", { name: "Active projects" });
    const [first, second] = within(list).getAllByRole("listitem");
    expect(within(first).getByRole("link", { name: "Website redesign" })).toHaveAttribute(
      "href",
      "/o/acme/projects/p1",
    );
    expect(first).toHaveTextContent("Wayne Enterprises");
    expect(first).toHaveTextContent("Due Sep 1, 2026 · overdue");
    expect(first).toHaveTextContent("3 open tasks");
    expect(
      within(first).getByRole("progressbar", { name: "Website redesign progress" }),
    ).toHaveAttribute("aria-valuenow", "40");
    expect(second).toHaveTextContent("No client");
    expect(second).toHaveTextContent("1 open task");
    expect(second).not.toHaveTextContent("overdue");
    expect(screen.getByText("Showing 2 of 7 active projects.")).toBeInTheDocument();
  });

  it("shows the task distribution and the invoice status summary", () => {
    renderDashboard(full);
    const tasks = within(screen.getByRole("list", { name: "Tasks by status" })).getAllByRole(
      "listitem",
    );
    expect(tasks.map((item) => item.textContent)).toEqual([
      "To do3 of 10, 30%",
      "In progress2 of 10, 20%",
      "Review1 of 10, 10%",
      "Done4 of 10, 40%",
    ]);

    const invoices = within(
      screen.getByRole("list", { name: "Invoice status summary" }),
    ).getAllByRole("link");
    expect(invoices.map((link) => [link.getAttribute("href"), link.textContent])).toEqual([
      ["/o/acme/invoices?status=DRAFT", "Draft1$1.00"],
      ["/o/acme/invoices?status=ISSUED", "Issued1$1,000.00"],
      ["/o/acme/invoices?status=OVERDUE", "Overdue1$500.00"],
      ["/o/acme/invoices?status=PAID", "Paid1$123.45"],
      ["/o/acme/invoices?status=CANCELLED", "Cancelled0—"],
    ]);
  });

  it("shows recent project and client activity linked to their subject", () => {
    renderDashboard(full);
    const project = screen.getByRole("list", { name: "Recent project activity" });
    expect(project).toHaveTextContent("Ada moved “Wireframes” from To do to Review");
    expect(within(project).getByRole("link", { name: "Website redesign" })).toHaveAttribute(
      "href",
      "/o/acme/projects/p1",
    );
    const client = screen.getByRole("list", { name: "Recent client activity" });
    expect(client).toHaveTextContent("A former member added this client");
    expect(within(client).getByRole("link", { name: "Wayne Enterprises" })).toHaveAttribute(
      "href",
      "/o/acme/clients/c1",
    );
  });

  it("keeps currencies separate instead of adding them together", () => {
    renderDashboard({
      ...full,
      invoices: summarizeInvoices(
        [
          { status: "PAID", currency: "USD", count: 1, cents: 1_000 },
          { status: "PAID", currency: "EUR", count: 1, cents: 2_000 },
        ],
        [],
      ),
    });
    expect(metric("Total paid")).toHaveTextContent("€20.00$10.00");
    expect(metric("Total paid")).toHaveTextContent("2 paid invoices");
    expect(metric("Overdue invoices")).toHaveTextContent("Nothing overdue");
    expect(metric("Total invoiced")).toHaveTextContent("Nothing outstanding");
  });

  it("names only the currencies with an outstanding balance", () => {
    renderDashboard({
      ...full,
      invoices: summarizeInvoices(
        [
          { status: "PAID", currency: "EUR", count: 1, cents: 2_500 },
          { status: "ISSUED", currency: "USD", count: 1, cents: 9_900 },
        ],
        [],
      ),
    });
    expect(metric("Total invoiced")).toHaveTextContent("$99.00 outstanding");
    expect(metric("Total invoiced")).not.toHaveTextContent("€0.00");
  });

  it("hides the invoice sections when the role cannot read invoices", () => {
    renderDashboard({ ...full, invoices: null }, false);
    expect(screen.queryByRole("heading", { name: "Overdue invoices" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Total invoiced" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Invoices" })).not.toBeInTheDocument();
    expect(screen.queryByText(/\$/)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Open tasks" })).toBeInTheDocument();
  });

  it("guides an empty organization and shows per-section empty states", () => {
    renderDashboard({
      clients: { total: 0, byStatus: { ACTIVE: 0, INACTIVE: 0, ARCHIVED: 0 } },
      projects: {
        active: 0,
        byStatus: { PLANNING: 0, ACTIVE: 0, ON_HOLD: 0, COMPLETED: 0, ARCHIVED: 0 },
        activeProjects: [],
      },
      tasks: { total: 0, open: 0, byStatus: { TODO: 0, IN_PROGRESS: 0, REVIEW: 0, DONE: 0 } },
      invoices: summarizeInvoices([], []),
      projectActivity: [],
      clientActivity: [],
    });
    expect(screen.getByRole("heading", { name: "Nothing to report yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a client" })).toHaveAttribute(
      "href",
      "/o/acme/clients/new",
    );
    expect(screen.getByText("No active projects.")).toBeInTheDocument();
    expect(screen.getByText("No tasks yet.")).toBeInTheDocument();
    expect(screen.getByText("No invoices yet.")).toBeInTheDocument();
    expect(screen.getByText("No project activity yet.")).toBeInTheDocument();
    expect(screen.getByText("No client activity yet.")).toBeInTheDocument();
    expect(metric("Total invoiced")).toHaveTextContent("No invoices issued yet");
  });

  it("offers no create links to roles that cannot create", () => {
    renderDashboard(
      {
        ...full,
        clients: { total: 0, byStatus: { ACTIVE: 0, INACTIVE: 0, ARCHIVED: 0 } },
        projects: {
          active: 0,
          byStatus: { PLANNING: 0, ACTIVE: 0, ON_HOLD: 0, COMPLETED: 0, ARCHIVED: 0 },
          activeProjects: [],
        },
        invoices: null,
      },
      false,
    );
    expect(screen.getByRole("heading", { name: "Nothing to report yet" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /add a client|new project|start one/i })).toBeNull();
  });
});
