// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InvoiceItemsEditor } from "./invoice-items-editor";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const items = [
  {
    id: "i1",
    description: "Design",
    quantityMilli: 1500,
    unitPriceCents: 10_000,
    amountCents: 15_000,
  },
];

describe("InvoiceItemsEditor", () => {
  const addAction = vi.fn();
  const updateAction = vi.fn();
  const removeAction = vi.fn();
  beforeEach(() => {
    router.refresh.mockReset();
    addAction.mockReset();
    updateAction.mockReset();
    removeAction.mockReset();
  });
  afterEach(cleanup);

  const renderEditor = (editable = true) =>
    render(
      <InvoiceItemsEditor
        organizationSlug="acme"
        invoiceId="inv1"
        currency="USD"
        items={items}
        editable={editable}
        addAction={addAction}
        updateAction={updateAction}
        removeAction={removeAction}
      />,
    );

  it("shows items with server-computed amounts", () => {
    renderEditor();
    const row = within(screen.getByRole("list", { name: "Line items" })).getAllByRole(
      "listitem",
    )[0];
    expect(row).toHaveTextContent("Design");
    expect(row).toHaveTextContent("1.5");
    expect(row).toHaveTextContent("$100.00");
    expect(row).toHaveTextContent("$150.00");
  });

  it("previews a new line exactly and sends the typed strings (not computed amounts)", async () => {
    addAction.mockResolvedValue({ ok: true, data: { id: "i2" } });
    renderEditor();
    fireEvent.change(screen.getByLabelText("New item description"), {
      target: { value: "Hosting" },
    });
    fireEvent.change(screen.getByLabelText("New item quantity"), { target: { value: "3" } });
    fireEvent.change(screen.getByLabelText("New item unit price"), { target: { value: "0.10" } });
    expect(screen.getByText("$0.30")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(addAction).toHaveBeenCalledWith("acme", {
        invoiceId: "inv1",
        description: "Hosting",
        quantity: "3",
        unitPrice: "0.10",
      }),
    );
    await waitFor(() => expect(screen.getByLabelText("New item description")).toHaveValue(""));
    expect(router.refresh).toHaveBeenCalled();
  });

  it("edits an item in place, prefilled with exact values", async () => {
    updateAction.mockResolvedValue({ ok: true, data: { id: "i1" } });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Edit Design" }));
    expect(screen.getByLabelText("Edit item quantity")).toHaveValue("1.5");
    expect(screen.getByLabelText("Edit item unit price")).toHaveValue("100.00");
    fireEvent.change(screen.getByLabelText("Edit item quantity"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(updateAction).toHaveBeenCalledWith("acme", {
        id: "i1",
        description: "Design",
        quantity: "2",
        unitPrice: "100.00",
      }),
    );
  });

  it("removes an item", async () => {
    removeAction.mockResolvedValue({ ok: true, data: { invoiceId: "inv1" } });
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Remove Design" }));
    await waitFor(() => expect(removeAction).toHaveBeenCalledWith("acme", { id: "i1" }));
  });

  it("shows the server's validation messages and keeps the input", async () => {
    addAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: [
          {
            path: "unitPrice",
            message: "Enter a price of up to 10,000,000 with at most 2 decimals",
          },
        ],
      },
    });
    renderEditor();
    fireEvent.change(screen.getByLabelText("New item description"), { target: { value: "Bad" } });
    fireEvent.change(screen.getByLabelText("New item unit price"), { target: { value: "1.001" } });
    expect(screen.getByText("—")).toBeInTheDocument(); // no preview for invalid input
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("at most 2 decimals");
    expect(screen.getByLabelText("New item description")).toHaveValue("Bad");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("is read-only for issued invoices or roles without edit rights", () => {
    renderEditor(false);
    expect(screen.queryByRole("button", { name: /Edit|Remove|Add/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New item description")).not.toBeInTheDocument();
  });

  it("clears a stale error and typed input when the invoice becomes read-only (e.g. after issuing)", async () => {
    addAction.mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: [{ path: "unitPrice", message: "Bad price" }],
      },
    });
    const props = {
      organizationSlug: "acme",
      invoiceId: "inv1",
      currency: "USD",
      items,
      addAction,
      updateAction,
      removeAction,
    };
    const { rerender } = render(<InvoiceItemsEditor {...props} editable />);
    fireEvent.change(screen.getByLabelText("New item description"), { target: { value: "Typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Bad price");

    rerender(<InvoiceItemsEditor {...props} editable={false} />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    // And nothing stale comes back if it becomes editable again.
    rerender(<InvoiceItemsEditor {...props} editable />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New item description")).toHaveValue("");
  });
});
