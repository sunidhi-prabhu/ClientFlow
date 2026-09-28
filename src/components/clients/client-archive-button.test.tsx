// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClientArchiveButton } from "./client-archive-button";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("ClientArchiveButton", () => {
  const archiveAction = vi.fn();
  const restoreAction = vi.fn();

  beforeEach(() => {
    router.refresh.mockReset();
    archiveAction.mockReset();
    restoreAction.mockReset();
  });
  afterEach(cleanup);

  const renderButton = (archived: boolean) =>
    render(
      <ClientArchiveButton
        organizationSlug="acme"
        clientId="client_1"
        archived={archived}
        archiveAction={archiveAction}
        restoreAction={restoreAction}
      />,
    );

  it("asks for confirmation before archiving, then refreshes", async () => {
    archiveAction.mockResolvedValue({ ok: true, data: {} });
    renderButton(false);

    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(archiveAction).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(archiveAction).toHaveBeenCalledWith("acme", { id: "client_1" });
  });

  it("can cancel the confirmation", () => {
    renderButton(false);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Archive" })).toBeInTheDocument();
    expect(archiveAction).not.toHaveBeenCalled();
  });

  it("shows the error when archiving fails and does not refresh", async () => {
    archiveAction.mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "You do not have permission to perform this action" },
    });
    renderButton(false);
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm archive" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("restores an archived client without a confirmation step", async () => {
    restoreAction.mockResolvedValue({ ok: true, data: {} });
    renderButton(true);
    fireEvent.click(screen.getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(restoreAction).toHaveBeenCalledWith("acme", { id: "client_1" }));
    expect(router.refresh).toHaveBeenCalled();
  });
});

describe("ClientArchiveButton keyboard focus", () => {
  afterEach(cleanup);

  it("moves focus to the confirmation and back to Archive when cancelled", () => {
    render(
      <ClientArchiveButton
        organizationSlug="acme"
        clientId="client_1"
        archived={false}
        archiveAction={vi.fn()}
        restoreAction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Archive" }));
    expect(screen.getByRole("button", { name: "Confirm archive" })).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Archive" })).toHaveFocus();
  });
});
