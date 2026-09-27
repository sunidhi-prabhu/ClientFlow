// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ClientForm } from "./client-form";

describe("ClientForm", () => {
  afterEach(cleanup);

  it("submits the entered values with the organization slug", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(<ClientForm organizationSlug="acme" action={action} submitLabel="Create client" />);

    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Wayne Enterprises" } });
    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "bruce@wayne.com" } });
    fireEvent.change(screen.getByLabelText("Status"), { target: { value: "INACTIVE" } });
    fireEvent.click(screen.getByRole("button", { name: "Create client" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    expect(action).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        name: "Wayne Enterprises",
        email: "bruce@wayne.com",
        status: "INACTIVE",
        company: "",
      }),
    );
  });

  it("includes the client id when editing and prefills the fields", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    render(
      <ClientForm
        organizationSlug="acme"
        action={action}
        submitLabel="Save changes"
        initial={{
          id: "client_1",
          name: "Old name",
          company: "Old Co",
          email: null,
          phone: null,
          address: null,
          notes: "Some notes",
          status: "ACTIVE",
        }}
      />,
    );
    expect(screen.getByLabelText("Name")).toHaveValue("Old name");
    expect(screen.getByLabelText("Notes")).toHaveValue("Some notes");

    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        "acme",
        expect.objectContaining({ id: "client_1", name: "Old name" }),
      ),
    );
  });

  it("shows server validation errors next to the fields", async () => {
    const action = vi.fn().mockResolvedValue({
      ok: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Validation failed",
        details: [
          { path: "name", message: "Enter a name" },
          { path: "email", message: "Enter a valid email address" },
        ],
      },
    });
    render(<ClientForm organizationSlug="acme" action={action} submitLabel="Create client" />);
    fireEvent.click(screen.getByRole("button", { name: "Create client" }));

    expect(await screen.findByText("Enter a name")).toBeInTheDocument();
    expect(screen.getByText("Enter a valid email address")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows other errors at the top of the form", async () => {
    const action = vi.fn().mockResolvedValue({
      ok: false,
      error: { code: "CONFLICT", message: "Restore this client before editing it" },
    });
    render(<ClientForm organizationSlug="acme" action={action} submitLabel="Save changes" />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Restore this client before editing it",
    );
  });
});
