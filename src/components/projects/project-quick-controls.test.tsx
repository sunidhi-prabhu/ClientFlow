// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectQuickControls } from "./project-quick-controls";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

describe("ProjectQuickControls", () => {
  const statusAction = vi.fn();
  const progressAction = vi.fn();
  beforeEach(() => {
    router.refresh.mockReset();
    statusAction.mockReset();
    progressAction.mockReset();
  });
  afterEach(cleanup);

  const renderControls = () =>
    render(
      <ProjectQuickControls
        organizationSlug="acme"
        projectId="p1"
        status="ACTIVE"
        progress={20}
        statusAction={statusAction}
        progressAction={progressAction}
      />,
    );

  it("changes the status immediately (archived is not offered)", async () => {
    statusAction.mockResolvedValue({ ok: true, data: {} });
    renderControls();
    const select = screen.getByLabelText("Status");
    expect(Array.from((select as HTMLSelectElement).options).map((option) => option.value)).toEqual(
      ["PLANNING", "ACTIVE", "ON_HOLD", "COMPLETED"],
    );

    fireEvent.change(select, { target: { value: "COMPLETED" } });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(statusAction).toHaveBeenCalledWith("acme", { id: "p1", status: "COMPLETED" });
  });

  it("saves progress only after it changed", async () => {
    progressAction.mockResolvedValue({ ok: true, data: {} });
    renderControls();
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Progress: 20%"), { target: { value: "65" } });
    expect(screen.getByLabelText("Progress: 65%")).toBeInTheDocument();
    fireEvent.click(save);
    await waitFor(() =>
      expect(progressAction).toHaveBeenCalledWith("acme", { id: "p1", progress: 65 }),
    );
  });

  it("shows errors", async () => {
    statusAction.mockResolvedValue({
      ok: false,
      error: { code: "FORBIDDEN", message: "You do not have permission to perform this action" },
    });
    renderControls();
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "ON_HOLD" } });
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission");
    expect(router.refresh).not.toHaveBeenCalled();
  });
});
