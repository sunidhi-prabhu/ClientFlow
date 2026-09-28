// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { NavLinks } from "@/components/layout/nav-links";

import { type AuditEntry, auditSummary, resourceHref } from "./audit-format";
import { AuditLogList } from "./audit-log-list";
import { AuditLogToolbar } from "./audit-log-toolbar";
import { auditLogHref } from "./audit-url";

const router = vi.hoisted(() => ({ replace: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router, usePathname: () => "/o/acme" }));

afterEach(() => {
  cleanup();
  router.replace.mockReset();
});

const entry = (overrides: Partial<AuditEntry>): AuditEntry => ({
  id: "a1",
  action: "client.updated",
  resourceType: "client",
  resourceId: "c1",
  metadata: { name: "Wayne Enterprises", changes: { email: { from: null, to: "x@y.z" } } },
  createdAt: new Date("2026-09-28T08:30:05Z"),
  actorUserId: "u1",
  actor: { name: "Ada Admin", email: "ada@example.com" },
  ...overrides,
});

describe("auditLogHref", () => {
  it("keeps only the filters that are set", () => {
    expect(auditLogHref("/o/acme/audit-log", {})).toBe("/o/acme/audit-log");
    expect(
      auditLogHref("/o/acme/audit-log", {
        from: "2026-09-01",
        to: "",
        actorId: "u1",
        action: "auth.login",
        resourceType: "",
        page: 2,
      }),
    ).toBe("/o/acme/audit-log?from=2026-09-01&actorId=u1&action=auth.login&page=2");
  });
});

describe("audit formatting", () => {
  it("links resources that have a page", () => {
    expect(resourceHref(entry({}), "/o/acme")).toBe("/o/acme/clients/c1");
    expect(
      resourceHref(
        entry({
          action: "task.assigned",
          resourceType: "task",
          resourceId: "t1",
          metadata: { projectId: "p1" },
        }),
        "/o/acme",
      ),
    ).toBe("/o/acme/projects/p1/tasks/t1");
    expect(
      resourceHref(
        entry({
          action: "task.deleted",
          resourceType: "task",
          resourceId: "t1",
          metadata: { projectId: "p1" },
        }),
        "/o/acme",
      ),
    ).toBeUndefined();
    expect(
      resourceHref(entry({ resourceType: "membership", resourceId: "m1" }), "/o/acme"),
    ).toBeUndefined();
  });

  it("summarizes role, permission, status and assignment changes", () => {
    expect(
      auditSummary(
        entry({
          action: "member.role_changed",
          resourceType: "membership",
          metadata: {
            member: { name: "Max" },
            role: { from: "MEMBER", to: "MANAGER" },
            permissions: { granted: ["a", "b"], revoked: [] },
          },
        }),
      ),
    ).toEqual(["Role: MEMBER → MANAGER", "Permissions: +2 / −0"]);
    expect(
      auditSummary(
        entry({
          action: "task.assigned",
          metadata: { assignee: { from: null, to: { userId: "u2", name: "Max" } } },
        }),
      ),
    ).toEqual(["Assignee: none → Max"]);
    expect(
      auditSummary(
        entry({
          action: "auth.login_failed",
          metadata: { reason: "INVALID_EMAIL_OR_PASSWORD", email: "a@b.c", ip: "127.0.0.1" },
        }),
      ),
    ).toEqual(["Reason: invalid email or password", "Account: a@b.c", "IP: 127.0.0.1"]);
  });
});

describe("AuditLogList", () => {
  it("shows time (UTC), actor, action, resource and details", () => {
    render(
      <AuditLogList
        basePath="/o/acme"
        entries={[
          entry({}),
          entry({
            id: "a2",
            action: "auth.login_failed",
            resourceType: "user",
            resourceId: "u9",
            actorUserId: null,
            actor: null,
            metadata: { email: "max@example.com", reason: "INVALID_EMAIL_OR_PASSWORD" },
          }),
        ]}
      />,
    );
    const [update, failed] = within(screen.getByRole("list", { name: "Audit log entries" }))
      .getAllByRole("listitem")
      .filter((item) => item.parentElement?.tagName === "OL");
    expect(update).toHaveTextContent("Sep 28, 2026, 8:30:05 AM UTC");
    expect(update).toHaveTextContent("Ada Admin");
    expect(update).toHaveTextContent("Client updated");
    expect(within(update).getByRole("link", { name: "Wayne Enterprises" })).toHaveAttribute(
      "href",
      "/o/acme/clients/c1",
    );
    expect(update).toHaveTextContent("Changed: email");
    expect(failed).toHaveTextContent("Unauthenticated");
    expect(failed).toHaveTextContent("Failed sign-in");
    expect(failed).toHaveTextContent("Account: max@example.com");
  });
});

describe("AuditLogToolbar", () => {
  const actors = [{ id: "u1", name: "Ada Admin", email: "ada@example.com" }];
  const empty = { from: "", to: "", actorId: "", action: "", resourceType: "" };

  it("updates the URL for each filter, keeping the others, and resets to page 1", () => {
    render(
      <AuditLogToolbar
        basePath="/o/acme/audit-log"
        filters={{ ...empty, action: "auth.login" }}
        actors={actors}
        noActorValue="none"
      />,
    );
    fireEvent.change(screen.getByLabelText("Actor"), { target: { value: "u1" } });
    expect(router.replace).toHaveBeenLastCalledWith(
      "/o/acme/audit-log?actorId=u1&action=auth.login",
      { scroll: false },
    );
    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    expect(router.replace).toHaveBeenLastCalledWith(
      "/o/acme/audit-log?from=2026-09-01&actorId=u1&action=auth.login",
      { scroll: false },
    );
    fireEvent.change(screen.getByLabelText("Resource"), { target: { value: "invoice" } });
    expect(router.replace).toHaveBeenLastCalledWith(
      "/o/acme/audit-log?from=2026-09-01&actorId=u1&action=auth.login&resourceType=invoice",
      { scroll: false },
    );
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute(
      "href",
      "/o/acme/audit-log",
    );
  });

  it("offers every action grouped by resource, and events without an actor", () => {
    render(<AuditLogToolbar basePath="/b" filters={empty} actors={actors} noActorValue="none" />);
    const action = screen.getByLabelText("Action");
    expect(within(action).getByRole("option", { name: "Role changed" })).toHaveValue(
      "member.role_changed",
    );
    expect(within(action).getByRole("group", { name: "User account" })).toBeInTheDocument();
    expect(
      within(screen.getByLabelText("Actor")).getByRole("option", { name: "No signed-in actor" }),
    ).toHaveValue("none");
    expect(screen.queryByRole("link", { name: "Clear filters" })).not.toBeInTheDocument();
  });
});

describe("Audit log navigation", () => {
  it("is listed for OWNER and ADMIN only", () => {
    for (const [role, visible] of [
      ["OWNER", true],
      ["ADMIN", true],
      ["MANAGER", false],
      ["MEMBER", false],
    ] as const) {
      render(<NavLinks orientation="vertical" basePath="/o/acme" role={role} />);
      const link = screen.queryByRole("link", { name: "Audit log" });
      expect({ role, visible: link !== null }).toEqual({ role, visible });
      if (link) expect(link).toHaveAttribute("href", "/o/acme/audit-log");
      cleanup();
    }
  });
});

describe("AuditLogToolbar while a navigation is pending", () => {
  it("keeps earlier changes and shows the chosen values before the page updates", () => {
    const empty = { from: "", to: "", actorId: "", action: "", resourceType: "" };
    render(
      <AuditLogToolbar
        basePath="/b"
        filters={{ ...empty, action: "client.updated" }}
        actors={[]}
        noActorValue="none"
      />,
    );
    // Two changes before the server re-renders with new props.
    fireEvent.change(screen.getByLabelText("Action"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Resource"), { target: { value: "user" } });
    expect(router.replace).toHaveBeenLastCalledWith("/b?resourceType=user", { scroll: false });
    expect(screen.getByLabelText("Action")).toHaveValue("");
    expect(screen.getByLabelText("Resource")).toHaveValue("user");
  });
});
