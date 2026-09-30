// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usageOf } from "@/lib/billing";

import { PlanLimitNotice } from "./plan-limit-notice";
import { type BillingModeProps, PricingTable } from "./pricing-table";
import { UsageMeter } from "./usage-meter";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const card = (name: string) =>
  within(screen.getByRole("list", { name: "Plans" })).getByRole("listitem", { name });
const prices = () => screen.getAllByTestId("plan-price").map((price) => price.textContent);

function billingProps(overrides: Partial<BillingModeProps> = {}): BillingModeProps {
  return {
    mode: "billing",
    organizationSlug: "acme",
    current: {
      plan: "FREE",
      interval: null,
      manageable: false,
      cancelAtPeriodEnd: false,
      hasScheduledChange: false,
    },
    canManage: true,
    configured: true,
    startCheckoutAction: vi.fn(async () => ({
      ok: true as const,
      data: { url: "https://rzp.io/i/sub_test" },
    })),
    changePlanAction: vi.fn(async () => ({ ok: true as const, data: null })),
    cancelAction: vi.fn(async () => ({ ok: true as const, data: null })),
    ...overrides,
  };
}

describe("PricingTable (public)", () => {
  it("shows every plan monthly by default and switches to annual prices", () => {
    render(<PricingTable mode="public" />);
    expect(prices()).toEqual(["$0", "$9/month", "$19/month", "$39/month", "$79/month"]);
    fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
    expect(screen.getByRole("button", { name: /Annual/ })).toHaveAttribute("aria-pressed", "true");
    expect(prices()).toEqual(["$0", "$90/year", "$190/year", "$390/year", "$790/year"]);
    expect(within(card("Growth")).getByText("Save $38 a year")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Monthly" }));
    expect(prices()[1]).toBe("$9/month");
  });

  it("shows GST on every paid plan", () => {
    render(<PricingTable mode="public" />);
    const tax = screen.getAllByTestId("plan-tax").map((line) => line.textContent);
    expect(tax).toEqual([
      "No GST",
      "+ 18% GST · $10.62/month total",
      "+ 18% GST · $22.42/month total",
      "+ 18% GST · $46.02/month total",
      "+ 18% GST · $93.22/month total",
    ]);
    fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
    expect(screen.getAllByTestId("plan-tax")[4]).toHaveTextContent(
      "+ 18% GST · $932.20/year total",
    );
  });

  it("lists each plan's limits and sends visitors to sign-up", () => {
    render(<PricingTable mode="public" />);
    expect(within(card("Free")).getByText("5 active clients")).toBeVisible();
    expect(within(card("Agency")).getByText("500 active projects")).toBeVisible();
    for (const link of within(screen.getByRole("list", { name: "Plans" })).getAllByRole("link")) {
      expect(link).toHaveAttribute("href", "/sign-up");
    }
  });

  it("stacks the plans on mobile", () => {
    render(<PricingTable mode="public" />);
    expect(screen.getByRole("list", { name: "Plans" })).toHaveClass(
      "grid-cols-1",
      "xl:grid-cols-5",
    );
  });
});

describe("PricingTable (billing page)", () => {
  it("shows the price, GST and total before paying, then links to Razorpay's page", async () => {
    const props = billingProps();
    render(<PricingTable {...props} />);
    expect(within(card("Free")).getByText("Current plan")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /Annual/ }));
    fireEvent.click(within(card("Growth")).getByRole("button", { name: "Upgrade to Growth" }));
    // Nothing is created until the customer has seen the total with GST.
    expect(props.startCheckoutAction).not.toHaveBeenCalled();
    const breakdown = within(card("Growth")).getByLabelText("Price breakdown");
    expect(breakdown).toHaveTextContent("Growth (annual)$190.00");
    expect(breakdown).toHaveTextContent("GST (18%)$34.20");
    expect(breakdown).toHaveTextContent("Total per year$224.20");
    expect(within(card("Growth")).getByText(/today and every year until you cancel/)).toBeVisible();
    fireEvent.click(within(card("Growth")).getByRole("button", { name: "Continue to payment" }));
    const pay = await within(card("Growth")).findByRole("link", { name: /Pay with Razorpay/ });
    expect(pay).toHaveAttribute("href", "https://rzp.io/i/sub_test");
    expect(pay).toHaveAttribute("target", "_blank");
    expect(pay).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(card("Growth")).getByText(/Pay \$224\.20 \(includes GST\)/)).toBeVisible();
    expect(props.startCheckoutAction).toHaveBeenCalledWith("acme", {
      plan: "GROWTH",
      interval: "YEAR",
    });
    fireEvent.click(within(card("Growth")).getByRole("button", { name: /refresh status/ }));
    expect(refresh).toHaveBeenCalled();
  });

  it("confirms plan changes on an existing subscription, saying when they apply", async () => {
    const props = billingProps({
      current: {
        plan: "GROWTH",
        interval: "MONTH",
        manageable: true,
        cancelAtPeriodEnd: false,
        hasScheduledChange: false,
      },
    });
    render(<PricingTable {...props} />);
    expect(within(card("Growth")).getByText("Current plan")).toBeVisible();
    fireEvent.click(within(card("Starter")).getByRole("button", { name: "Downgrade to Starter" }));
    expect(
      within(card("Starter")).getByText("Applies at the end of the current billing period."),
    ).toBeVisible();
    fireEvent.click(within(card("Starter")).getByRole("button", { name: "Back" }));
    fireEvent.click(within(card("Agency")).getByRole("button", { name: "Upgrade to Agency" }));
    expect(within(card("Agency")).getByText(/Applies right away/)).toBeVisible();
    expect(within(card("Agency")).getByTestId("price-total")).toHaveTextContent("$93.22");
    expect(props.changePlanAction).not.toHaveBeenCalled();
    fireEvent.click(within(card("Agency")).getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(props.changePlanAction).toHaveBeenCalledWith("acme", {
        plan: "AGENCY",
        interval: "MONTH",
      }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(
      within(card("Starter")).getByRole("button", { name: "Downgrade to Starter" }),
    ).toBeVisible();
  });

  it("downgrades to Free by cancelling at the end of the period (final)", async () => {
    const props = billingProps({
      current: {
        plan: "STARTER",
        interval: "YEAR",
        manageable: true,
        cancelAtPeriodEnd: false,
        hasScheduledChange: false,
      },
    });
    render(<PricingTable {...props} />);
    fireEvent.click(within(card("Free")).getByRole("button", { name: "Downgrade to Free" }));
    expect(within(card("Free")).getByText(/can't be undone; nothing is deleted/)).toBeVisible();
    fireEvent.click(within(card("Free")).getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(props.cancelAction).toHaveBeenCalledWith("acme", {}));
  });

  it.each([
    ["a cancellation", { cancelAtPeriodEnd: true, hasScheduledChange: false }],
    ["a scheduled plan change", { cancelAtPeriodEnd: false, hasScheduledChange: true }],
  ])("offers no plan actions while %s is pending", (_label, pending) => {
    render(
      <PricingTable
        {...billingProps({
          current: { plan: "GROWTH", interval: "MONTH", manageable: true, ...pending },
        })}
      />,
    );
    expect(within(screen.getByRole("list", { name: "Plans" })).queryAllByRole("button")).toEqual(
      [],
    );
  });

  it("shows the server's error (e.g. a refused change)", async () => {
    const props = billingProps({
      startCheckoutAction: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: "FORBIDDEN" as const,
          message: "You do not have permission to perform this action",
        },
      })),
    });
    render(<PricingTable {...props} />);
    fireEvent.click(within(card("Starter")).getByRole("button", { name: "Upgrade to Starter" }));
    fireEvent.click(within(card("Starter")).getByRole("button", { name: "Continue to payment" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("You do not have permission");
  });

  it("offers no plan actions to roles that cannot manage billing", () => {
    render(<PricingTable {...billingProps({ canManage: false })} />);
    expect(within(screen.getByRole("list", { name: "Plans" })).queryAllByRole("button")).toEqual(
      [],
    );
  });

  it("marks paid plans unavailable when billing is not configured", () => {
    render(<PricingTable {...billingProps({ configured: false })} />);
    expect(within(card("Agency")).getByText("Not available yet")).toBeVisible();
    cleanup();
    // An existing subscription cannot be cancelled here either while billing is off.
    render(
      <PricingTable
        {...billingProps({
          configured: false,
          current: {
            plan: "GROWTH",
            interval: "MONTH",
            manageable: true,
            cancelAtPeriodEnd: false,
            hasScheduledChange: false,
          },
        })}
      />,
    );
    expect(within(card("Free")).queryByRole("button")).not.toBeInTheDocument();
  });
});

describe("UsageMeter", () => {
  it("shows used / limit and the remaining capacity", () => {
    render(<UsageMeter label="clients" usage={usageOf(7, 50)} />);
    expect(screen.getByTestId("usage-clients")).toHaveTextContent("7 / 50");
    expect(screen.getByText("43 more clients available.")).toBeVisible();
  });

  it("explains an over-limit organization after a downgrade", () => {
    render(<UsageMeter label="projects" usage={usageOf(12, 5)} />);
    expect(
      screen.getByText(/7 over your plan's limit\. Existing projects stay fully usable/),
    ).toBeVisible();
  });
});

describe("PlanLimitNotice", () => {
  it("renders nothing below the limit", () => {
    const { container } = render(
      <PlanLimitNotice resource="clients" usage={{ ...usageOf(4, 5), plan: "FREE" }} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("explains the limit and links owners/admins to the plans", () => {
    render(
      <PlanLimitNotice
        resource="clients"
        usage={{ ...usageOf(5, 5), plan: "FREE" }}
        billingPath="/o/acme/billing"
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "You've reached your 5-client limit. Upgrade your plan to add more clients.",
    );
    expect(screen.getByRole("status")).toHaveTextContent("5 / 5 active clients on the Free plan.");
    expect(screen.getByRole("link", { name: "View plans" })).toHaveAttribute(
      "href",
      "/o/acme/billing",
    );
  });

  it("tells other roles who can upgrade", () => {
    render(<PlanLimitNotice resource="projects" usage={{ ...usageOf(15, 15), plan: "STARTER" }} />);
    expect(screen.getByRole("status")).toHaveTextContent("Ask an owner or admin to upgrade.");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
