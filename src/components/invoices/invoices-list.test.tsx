// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvoiceForm } from "./invoice-form";
import { InvoiceTotals } from "./invoice-totals";
import { InvoicesEmptyState } from "./invoices-empty-state";
import { InvoicesTable, type InvoiceRow } from "./invoices-table";
import { InvoicesToolbar } from "./invoices-toolbar";
import { invoicesListHref } from "./invoices-url";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

afterEach(cleanup);

const row = (overrides: Partial<InvoiceRow>): InvoiceRow => ({
  id: "inv1",
  number: 7,
  status: "ISSUED",
  currency: "EUR",
  issueDate: new Date("2026-01-01T00:00:00Z"),
  dueDate: new Date("2099-01-31T00:00:00Z"),
  totalCents: 123_450,
  client: { id: "c1", name: "Wayne Enterprises" },
  ...overrides,
});

describe("InvoicesTable", () => {
  it("shows number, client, dates, derived status, payment status and exact total", () => {
    render(
      <InvoicesTable
        basePath="/o/acme/invoices"
        invoices={[
          row({}),
          row({
            id: "inv2",
            number: 8,
            dueDate: new Date("2000-01-01T00:00:00Z"),
            currency: "USD",
            totalCents: 10,
          }),
          row({ id: "inv3", number: null, status: "DRAFT", issueDate: null }),
        ]}
      />,
    );
    const [, issued, overdue, draft] = within(screen.getByRole("table")).getAllByRole("row");
    expect(within(issued).getByRole("link", { name: "INV-0007" })).toHaveAttribute(
      "href",
      "/o/acme/invoices/inv1",
    );
    expect(issued).toHaveTextContent("Wayne Enterprises");
    expect(issued).toHaveTextContent("Jan 1, 2026");
    expect(issued).toHaveTextContent("Issued");
    expect(issued).toHaveTextContent("Awaiting payment");
    expect(issued).toHaveTextContent("€1,234.50");
    expect(overdue).toHaveTextContent("Overdue");
    expect(overdue).toHaveTextContent("Unpaid · overdue");
    expect(overdue).toHaveTextContent("$0.10");
    expect(draft).toHaveTextContent("Draft");
    expect(draft).toHaveTextContent("Not issued");
  });
});

describe("InvoiceTotals", () => {
  it("shows the stored breakdown", () => {
    render(
      <InvoiceTotals
        currency="USD"
        subtotalCents={15_030}
        discountBps={1000}
        discountCents={1_503}
        taxBps={2000}
        taxCents={2_705}
        totalCents={16_232}
      />,
    );
    const totals = screen.getByLabelText("Invoice totals");
    expect(totals).toHaveTextContent("Subtotal$150.30");
    expect(totals).toHaveTextContent("Discount (10%)−$15.03");
    expect(totals).toHaveTextContent("Tax (20%)$27.05");
    expect(totals).toHaveTextContent("Total$162.32");
  });
});

describe("InvoicesEmptyState and URLs", () => {
  it("distinguishes empty from filtered, and hides create without permission", () => {
    const { rerender } = render(
      <InvoicesEmptyState filtered={false} basePath="/o/acme/invoices" canCreate />,
    );
    expect(screen.getByRole("link", { name: "New invoice" })).toHaveAttribute(
      "href",
      "/o/acme/invoices/new",
    );
    rerender(<InvoicesEmptyState filtered basePath="/o/acme/invoices" canCreate />);
    expect(screen.getByText("No matching invoices")).toBeInTheDocument();
    rerender(<InvoicesEmptyState filtered={false} basePath="/o/acme/invoices" canCreate={false} />);
    expect(screen.queryByRole("link", { name: "New invoice" })).not.toBeInTheDocument();
  });

  it("builds list URLs with only non-default parameters", () => {
    expect(invoicesListHref("/o/acme/invoices", { status: "all", sort: "newest", page: 1 })).toBe(
      "/o/acme/invoices",
    );
    expect(
      invoicesListHref("/o/acme/invoices", {
        q: "INV-7",
        status: "OVERDUE",
        clientId: "c1",
        sort: "due",
        page: 2,
      }),
    ).toBe("/o/acme/invoices?q=INV-7&status=OVERDUE&clientId=c1&sort=due&page=2");
  });
});

describe("InvoicesToolbar", () => {
  beforeEach(() => router.replace.mockReset());

  it("filters by status (with counts) and client", () => {
    render(
      <InvoicesToolbar
        basePath="/o/acme/invoices"
        q=""
        status="all"
        clientId=""
        sort="newest"
        clients={[{ id: "c1", name: "Wayne" }]}
        statusCounts={{ DRAFT: 1, ISSUED: 2, OVERDUE: 3, PAID: 4, CANCELLED: 0 }}
      />,
    );
    expect(screen.getByRole("option", { name: "All statuses (10)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Overdue (3)" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), {
      target: { value: "OVERDUE" },
    });
    expect(router.replace).toHaveBeenLastCalledWith("/o/acme/invoices?status=OVERDUE", {
      scroll: false,
    });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by client" }), {
      target: { value: "c1" },
    });
    expect(router.replace).toHaveBeenLastCalledWith("/o/acme/invoices?clientId=c1", {
      scroll: false,
    });
  });
});

describe("InvoiceForm", () => {
  it("submits the header fields as typed, with the id when editing", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(
      <InvoiceForm
        organizationSlug="acme"
        action={action}
        clients={[
          { id: "c1", name: "Wayne" },
          { id: "c2", name: "Stark" },
        ]}
        submitLabel="Save changes"
        initial={{
          id: "inv1",
          clientId: "c1",
          currency: "EUR",
          dueDate: "2026-12-01",
          notes: null,
          discountPercent: "10",
          taxPercent: "18.25",
        }}
      />,
    );
    expect(screen.getByLabelText("Tax (%)")).toHaveValue("18.25");
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "c2" } });
    fireEvent.change(screen.getByLabelText("Discount (%)"), { target: { value: "12.5" } });
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Save changes" })));
    expect(action).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        id: "inv1",
        clientId: "c2",
        currency: "EUR",
        discountPercent: "12.5",
        taxPercent: "18.25",
        dueDate: "2026-12-01",
      }),
    );
  });

  it("shows server validation errors next to fields", async () => {
    const action = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: [
          { path: "taxPercent", message: "Tax must be between 0 and 100 (up to 2 decimals)" },
        ],
      },
    });
    render(
      <InvoiceForm
        organizationSlug="acme"
        action={action}
        clients={[{ id: "c1", name: "Wayne" }]}
        submitLabel="Create draft"
      />,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Create draft" })));
    expect(
      await screen.findByText("Tax must be between 0 and 100 (up to 2 decimals)"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Tax (%)")).toHaveAttribute("aria-invalid", "true");
  });
});
