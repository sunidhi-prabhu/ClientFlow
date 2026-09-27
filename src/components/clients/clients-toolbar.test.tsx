// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientsToolbar } from "./clients-toolbar";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const counts = { ACTIVE: 3, INACTIVE: 1, ARCHIVED: 2 };

function renderToolbar(overrides: Partial<Parameters<typeof ClientsToolbar>[0]> = {}) {
  return render(
    <ClientsToolbar
      basePath="/o/acme/clients"
      q=""
      status="current"
      sort="name"
      statusCounts={counts}
      {...overrides}
    />,
  );
}

describe("ClientsToolbar", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    router.replace.mockReset();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("debounces search and navigates once with the trimmed query", () => {
    renderToolbar();
    const input = screen.getByRole("searchbox", { name: "Search clients" });

    fireEvent.change(input, { target: { value: "ac" } });
    fireEvent.change(input, { target: { value: "acme " } });
    expect(router.replace).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(300));
    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/o/acme/clients?q=acme", { scroll: false });
  });

  it("changing the status filter navigates immediately and resets to page 1", () => {
    renderToolbar({ q: "acme", sort: "updated" });
    fireEvent.change(screen.getByRole("combobox", { name: "Filter by status" }), {
      target: { value: "ARCHIVED" },
    });
    expect(router.replace).toHaveBeenCalledWith(
      "/o/acme/clients?q=acme&status=ARCHIVED&sort=updated",
      { scroll: false },
    );
  });

  it("shows per-status counts in the filter", () => {
    renderToolbar();
    expect(screen.getByRole("option", { name: "Active & inactive (4)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Archived (2)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "All clients (6)" })).toBeInTheDocument();
  });

  it("submitting the search (Enter) navigates without waiting for the debounce", () => {
    renderToolbar();
    const input = screen.getByRole("searchbox", { name: "Search clients" });
    fireEvent.change(input, { target: { value: "wayne" } });
    fireEvent.submit(screen.getByRole("search"));
    expect(router.replace).toHaveBeenCalledWith("/o/acme/clients?q=wayne", { scroll: false });
    act(() => vi.advanceTimersByTime(300));
    expect(router.replace).toHaveBeenCalledTimes(1);
  });

  it("follows URL changes made elsewhere, but keeps what the user is typing", () => {
    const { rerender } = renderToolbar({ q: "acme" });
    const input = screen.getByRole("searchbox", { name: "Search clients" });
    expect(input).toHaveValue("acme");

    // e.g. "Clear filters" or the back button
    rerender(
      <ClientsToolbar
        basePath="/o/acme/clients"
        q=""
        status="current"
        sort="name"
        statusCounts={counts}
      />,
    );
    expect(input).toHaveValue("");

    // The debounced navigation stores the trimmed value; the trailing space stays.
    fireEvent.change(input, { target: { value: "acme " } });
    rerender(
      <ClientsToolbar
        basePath="/o/acme/clients"
        q="acme"
        status="current"
        sort="name"
        statusCounts={counts}
      />,
    );
    expect(input).toHaveValue("acme ");
  });
});
