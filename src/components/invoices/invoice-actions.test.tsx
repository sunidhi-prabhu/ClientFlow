// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvoiceActions } from "./invoice-actions";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("InvoiceActions", () => {
  const actions = { issue: vi.fn(), pay: vi.fn(), cancel: vi.fn() };
  beforeEach(() => {
    router.refresh.mockReset();
    Object.values(actions).forEach((action) => action.mockReset());
  });
  afterEach(cleanup);

  const renderActions = (allowed = { issue: true, pay: false, cancel: true }) =>
    render(
      <InvoiceActions
        organizationSlug="acme"
        invoiceId="inv1"
        allowed={allowed}
        actions={actions}
      />,
    );

  it("shows only the actions allowed for this state and role", () => {
    renderActions({ issue: false, pay: true, cancel: false });
    expect(screen.getByRole("button", { name: "Mark as paid" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Issue invoice" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel invoice" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print" })).toBeInTheDocument();
  });

  it("asks for confirmation, then runs the action and refreshes", async () => {
    actions.issue.mockResolvedValue({ ok: true, data: { status: "ISSUED" } });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    expect(actions.issue).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Issue now (locks the invoice)" }));
    await waitFor(() => expect(actions.issue).toHaveBeenCalledWith("acme", { id: "inv1" }));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("can back out of a confirmation", () => {
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Cancel invoice" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(actions.cancel).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel invoice" })).toBeInTheDocument();
  });

  it("shows why the server refused (including validation details)", async () => {
    actions.issue.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "This invoice cannot be issued yet",
        details: [
          { path: "items", message: "Add at least one line item" },
          { path: "dueDate", message: "Set a due date" },
        ],
      },
    });
    renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Issue invoice" }));
    fireEvent.click(screen.getByRole("button", { name: "Issue now (locks the invoice)" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This invoice cannot be issued yet: Add at least one line item · Set a due date",
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
