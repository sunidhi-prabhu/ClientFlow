// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectForm } from "./project-form";

const clients = [
  { id: "client_1", name: "Wayne Enterprises" },
  { id: "client_2", name: "Stark Industries" },
];

describe("ProjectForm", () => {
  afterEach(cleanup);

  it("submits all fields, including client, dates and progress", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectForm
        organizationSlug="acme"
        action={action}
        clients={clients}
        submitLabel="Create project"
      />,
    );

    fireEvent.change(screen.getByLabelText("Project name"), { target: { value: "Website" } });
    fireEvent.change(screen.getByLabelText("Client"), { target: { value: "client_2" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "URGENT" } });
    fireEvent.change(screen.getByLabelText("Start date"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-12-15" } });
    fireEvent.change(screen.getByLabelText("Progress (%)"), { target: { value: "30" } });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        name: "Website",
        clientId: "client_2",
        status: "PLANNING",
        priority: "URGENT",
        startDate: "2026-10-01",
        dueDate: "2026-12-15",
        progress: "30",
      }),
    );
  });

  it("offers 'No client' and only the given clients", () => {
    render(
      <ProjectForm organizationSlug="acme" action={vi.fn()} clients={clients} submitLabel="Save" />,
    );
    const options = screen
      .getAllByRole("option")
      .filter((option) => option.closest("select")?.getAttribute("name") === "clientId");
    expect(options.map((option) => option.textContent)).toEqual([
      "No client",
      "Wayne Enterprises",
      "Stark Industries",
    ]);
  });

  it("prefills when editing and sends the project id", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(
      <ProjectForm
        organizationSlug="acme"
        action={action}
        clients={clients}
        submitLabel="Save changes"
        initial={{
          id: "project_1",
          name: "Old name",
          description: "Scope",
          clientId: "client_1",
          status: "ON_HOLD",
          priority: "HIGH",
          startDate: "2026-01-05",
          dueDate: "",
          progress: 40,
        }}
      />,
    );
    expect(screen.getByLabelText("Client")).toHaveValue("client_1");
    expect(screen.getByLabelText("Status")).toHaveValue("ON_HOLD");
    expect(screen.getByLabelText("Start date")).toHaveValue("2026-01-05");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        "acme",
        expect.objectContaining({ id: "project_1", name: "Old name", progress: "40" }),
      ),
    );
  });

  it("shows server errors next to the fields and at the top", async () => {
    const action = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Validation failed",
          details: [{ path: "dueDate", message: "Due date cannot be before the start date" }],
        },
      })
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "NOT_FOUND", message: "Referenced resource not found" },
      });
    render(
      <ProjectForm organizationSlug="acme" action={action} clients={clients} submitLabel="Save" />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Due date cannot be before the start date")).toBeInTheDocument();
    expect(screen.getByLabelText("Due date")).toHaveAttribute("aria-invalid", "true");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Referenced resource not found");
  });
});
