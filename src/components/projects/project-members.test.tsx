// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectMembers } from "./project-members";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const members = [{ userId: "u1", name: "Ada", email: "ada@example.com", role: "MANAGER" }];
const addable = [{ userId: "u2", name: "Grace", email: "grace@example.com" }];

describe("ProjectMembers", () => {
  const addAction = vi.fn();
  const removeAction = vi.fn();
  beforeEach(() => {
    router.refresh.mockReset();
    addAction.mockReset();
    removeAction.mockReset();
  });
  afterEach(cleanup);

  const renderMembers = (canManage = true) =>
    render(
      <ProjectMembers
        organizationSlug="acme"
        projectId="p1"
        members={members}
        addable={addable}
        canManage={canManage}
        addAction={addAction}
        removeAction={removeAction}
      />,
    );

  it("adds the selected person and refreshes", async () => {
    addAction.mockResolvedValue({ ok: true, data: {} });
    renderMembers();

    expect(screen.getByRole("button", { name: "Add" })).toBeDisabled();
    fireEvent.change(screen.getByRole("combobox", { name: "Person to add" }), {
      target: { value: "u2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(addAction).toHaveBeenCalledWith("acme", { projectId: "p1", userId: "u2" });
  });

  it("removes a member", async () => {
    removeAction.mockResolvedValue({ ok: true, data: {} });
    renderMembers();
    fireEvent.click(screen.getByRole("button", { name: "Remove Ada" }));
    await waitFor(() =>
      expect(removeAction).toHaveBeenCalledWith("acme", { projectId: "p1", userId: "u1" }),
    );
  });

  it("shows the server's error and does not refresh", async () => {
    addAction.mockResolvedValue({
      ok: false,
      error: { code: "NOT_FOUND", message: "Referenced resource not found" },
    });
    renderMembers();
    fireEvent.change(screen.getByRole("combobox", { name: "Person to add" }), {
      target: { value: "u2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Referenced resource not found");
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("is read-only for roles that cannot manage the project", () => {
    renderMembers(false);
    expect(screen.getByText("Ada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove Ada" })).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Person to add" })).not.toBeInTheDocument();
  });
});
