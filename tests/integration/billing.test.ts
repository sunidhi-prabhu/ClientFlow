import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as webhook } from "@/app/api/billing/webhook/route";
import {
  cancelSubscriptionAction,
  changePlanAction,
  openBillingPortalAction,
  resumeSubscriptionAction,
  startCheckoutAction,
} from "@/app/o/[orgSlug]/billing/actions";
import { createClientAction } from "@/app/o/[orgSlug]/clients/actions";
import { type MembershipRole } from "@/generated/prisma/enums";
import { type BillingInterval, type PaidPlan } from "@/lib/billing";
import { getDb } from "@/lib/db";
import { getBillingOverview } from "@/server/billing/service";
import type * as StripeModule from "@/server/billing/stripe";
import { syncCheckoutSession } from "@/server/billing/sync";
import { createOrganization } from "@/server/organizations/bootstrap";
import { tenantPage } from "@/server/protected";
import { getTenantDb } from "@/server/tenancy";

import { TEST_BILLING_ENV as PRICES } from "../support/billing-config";
import { clearBillingEnv } from "../support/billing-env";
import { createVerifiedUser } from "./support/auth";
import { fakeStripe, webhookRequest } from "./support/fake-stripe";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);
// Stripe is replaced by an in-memory fake; webhook signatures are still
// verified by the real Stripe SDK code.
vi.mock("@/server/billing/stripe", async (importOriginal) => {
  const actual = await importOriginal<typeof StripeModule>();
  const { fakeStripe: fake } = await import("./support/fake-stripe");
  const { TEST_BILLING_ENV } = await import("../support/billing-config");
  fake.verifier = (payload: string, signature: string | null) =>
    actual.verifyStripeWebhook(payload, signature, TEST_BILLING_ENV.STRIPE_WEBHOOK_SECRET);
  return { ...actual, stripeBillingProvider: fake.provider };
});

type Member = { userId: string; cookie: string };
let acme: { id: string; slug: string };
let globex: { id: string; slug: string };
const members = {} as Record<MembershipRole, Member>;
let outsider: Member;

const billing = (organizationId: string) =>
  getDb().subscription.findUnique({ where: { organizationId } });
const auditActions = async (organizationId: string) =>
  (
    await getDb().auditLog.findMany({
      where: { organizationId, action: { startsWith: "billing." } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { action: true, actorUserId: true, metadata: true },
    })
  ).map((row) => row.action);

async function postWebhook(...args: Parameters<typeof webhookRequest>) {
  const response = await webhook(webhookRequest(...args));
  return { status: response.status, body: await response.json() };
}

/** Checkout started by the OWNER and completed on "Stripe", then its webhook delivered. */
async function subscribe(plan: PaidPlan = "GROWTH", interval: BillingInterval = "MONTH") {
  actAs(members.OWNER.cookie);
  const result = await startCheckoutAction("acme", { plan, interval });
  if (!result.ok) throw new Error(result.error.message);
  const sessionId = result.data.url.split("/").pop()!;
  const subscription = fakeStripe.completeCheckout(sessionId);
  const delivered = await postWebhook("checkout.session.completed", {
    id: sessionId,
    object: "checkout.session",
    customer: subscription.customerId,
    subscription: subscription.id,
    client_reference_id: acme.id,
  });
  expect(delivered.status).toBe(200);
  return { sessionId, subscription };
}

const subscriptionEvent = (subscription: { id: string; customerId: string }) => ({
  id: subscription.id,
  object: "subscription",
  customer: subscription.customerId,
});

beforeEach(async () => {
  fakeStripe.reset();
  const owner = await createVerifiedUser("owner@example.com");
  acme = await createOrganization(owner.userId, { name: "Acme", slug: "acme" });
  members.OWNER = owner;
  for (const role of ["ADMIN", "MANAGER", "MEMBER"] as const) {
    const user = await createVerifiedUser(`${role.toLowerCase()}@example.com`);
    await getDb().membership.create({
      data: { organizationId: acme.id, userId: user.userId, role },
    });
    members[role] = user;
  }
  outsider = await createVerifiedUser("outsider@example.com");
  globex = await createOrganization(outsider.userId, { name: "Globex", slug: "globex" });
});

describe("checkout", () => {
  it("OWNER starts Stripe Checkout with the server-configured Price for the chosen plan", async () => {
    actAs(members.OWNER.cookie);
    const result = await startCheckoutAction("acme", {
      plan: "GROWTH",
      interval: "YEAR",
      // Forged values: ignored.
      priceId: "price_startermonthly",
      organizationId: globex.id,
      clientLimit: 10_000,
    });
    expect(result).toMatchObject({ ok: true, data: { url: expect.stringContaining("cs_test_") } });
    expect(fakeStripe.checkouts).toHaveLength(1);
    expect(fakeStripe.checkouts[0]).toMatchObject({
      priceId: PRICES.STRIPE_PRICE_GROWTH_ANNUAL,
      organizationId: acme.id,
      successUrl: "http://localhost:3000/o/acme/billing?checkout=success",
      cancelUrl: "http://localhost:3000/o/acme/billing?checkout=cancelled",
    });
    // A customer is recorded; the plan does not change until Stripe confirms payment.
    expect(await billing(acme.id)).toMatchObject({
      plan: "FREE",
      status: null,
      stripeCustomerId: fakeStripe.customers[0].id,
    });
    expect(await billing(globex.id)).toBeNull();
    expect(await auditActions(acme.id)).toEqual(["billing.checkout_started"]);
  });

  it("ADMIN may manage billing too; the customer is reused for a second attempt", async () => {
    actAs(members.ADMIN.cookie);
    expect(await startCheckoutAction("acme", { plan: "STARTER", interval: "MONTH" })).toMatchObject(
      { ok: true },
    );
    expect(await startCheckoutAction("acme", { plan: "AGENCY", interval: "MONTH" })).toMatchObject({
      ok: true,
    });
    expect(fakeStripe.customers).toHaveLength(1);
    expect(fakeStripe.checkouts.map((checkout) => checkout.customerId)).toEqual([
      fakeStripe.customers[0].id,
      fakeStripe.customers[0].id,
    ]);
  });

  it.each(["MANAGER", "MEMBER"] as const)(
    "%s cannot start checkout (403, nothing created)",
    async (role) => {
      actAs(members[role].cookie);
      // Even with a forged role in the payload.
      expect(
        await startCheckoutAction("acme", { plan: "GROWTH", interval: "MONTH", role: "OWNER" }),
      ).toMatchObject({
        ok: false,
        error: { code: "FORBIDDEN" },
      });
      expect(fakeStripe.customers).toEqual([]);
      expect(await billing(acme.id)).toBeNull();
    },
  );

  it("non-members get 404 and signed-out callers 401", async () => {
    actAs(outsider.cookie);
    expect(await startCheckoutAction("acme", { plan: "GROWTH", interval: "MONTH" })).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    actAs(undefined);
    expect(await startCheckoutAction("acme", { plan: "GROWTH", interval: "MONTH" })).toMatchObject({
      ok: false,
      error: { code: "UNAUTHENTICATED" },
    });
    expect(fakeStripe.checkouts).toEqual([]);
  });

  it.each([
    [{ plan: "ENTERPRISE", interval: "MONTH" }],
    [{ plan: "FREE", interval: "MONTH" }],
    [{ plan: "GROWTH", interval: "DAY" }],
    [{ priceId: "price_growthmonthly" }],
  ])("rejects forged plan input %j", async (input) => {
    actAs(members.OWNER.cookie);
    expect(await startCheckoutAction("acme", input)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(fakeStripe.checkouts).toEqual([]);
  });

  it("refuses a second subscription while one is active", async () => {
    await subscribe();
    expect(await startCheckoutAction("acme", { plan: "AGENCY", interval: "MONTH" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
  });
});

describe("billing page access", () => {
  it("only OWNER and ADMIN can open the billing page", async () => {
    const allowed: Record<string, boolean> = {};
    for (const role of ["OWNER", "ADMIN", "MANAGER", "MEMBER"] as const) {
      actAs(members[role].cookie);
      allowed[role] = (await tenantPage("acme", "billing:read")).allowed;
    }
    expect(allowed).toEqual({ OWNER: true, ADMIN: true, MANAGER: false, MEMBER: false });
    actAs(outsider.cookie);
    await expect(tenantPage("acme", "billing:read")).rejects.toThrow();
  });

  it("the portal is for billing managers of the organization only", async () => {
    await subscribe();
    actAs(members.MEMBER.cookie);
    expect(await openBillingPortalAction("acme", {})).toMatchObject({
      ok: false,
      error: { code: "FORBIDDEN" },
    });
    actAs(outsider.cookie);
    expect(await openBillingPortalAction("acme", {})).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND" },
    });
    actAs(members.ADMIN.cookie);
    expect(await openBillingPortalAction("acme", {})).toMatchObject({
      ok: true,
      data: { url: `https://billing.stripe.test/${fakeStripe.customers[0].id}` },
    });
  });
});

describe("webhooks", () => {
  it("activates the paid plan from a verified checkout.session.completed event", async () => {
    const { subscription } = await subscribe("GROWTH", "MONTH");
    expect(await billing(acme.id)).toMatchObject({
      plan: "GROWTH",
      interval: "MONTH",
      status: "ACTIVE",
      stripeSubscriptionId: subscription.id,
      currentPeriodEnd: new Date(Date.UTC(2030, 0, 1)),
    });
    const overview = await getBillingOverview(getTenantDb(acme.id));
    expect(overview.entitlements).toEqual({
      plan: "GROWTH",
      limits: { clients: 50, projects: 50 },
    });
    const activated = await getDb().auditLog.findFirstOrThrow({
      where: { organizationId: acme.id, action: "billing.subscription_activated" },
    });
    expect(activated).toMatchObject({ actorUserId: null, resourceId: subscription.id });
    expect(activated.metadata).toMatchObject({
      plan: "GROWTH",
      interval: "MONTH",
      status: "ACTIVE",
    });

    // The upgrade applies immediately: a 6th client is now allowed.
    await getDb().client.createMany({
      data: Array.from({ length: 5 }, (_, index) => ({
        organizationId: acme.id,
        name: `C${index}`,
      })),
    });
    actAs(members.MANAGER.cookie);
    await expect(createClientAction("acme", { name: "Sixth" })).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  it.each([
    ["no signature", { signature: null }],
    ["a signature made with another secret", { secret: "whsec_attacker" }],
    ["a malformed signature", { signature: "t=1,v1=deadbeef" }],
  ])("rejects %s with 400 and changes nothing", async (_label, options) => {
    actAs(members.OWNER.cookie);
    await startCheckoutAction("acme", { plan: "AGENCY", interval: "YEAR" });
    const customerId = fakeStripe.customers[0].id;
    const sessionId = [...fakeStripe.sessions.keys()][0];
    const subscription = fakeStripe.completeCheckout(sessionId);
    const result = await postWebhook(
      "checkout.session.completed",
      {
        id: sessionId,
        object: "checkout.session",
        customer: customerId,
        subscription: subscription.id,
        client_reference_id: acme.id,
      },
      options,
    );
    expect(result).toEqual({
      status: 400,
      body: { error: { code: "BAD_REQUEST", message: "Invalid signature" } },
    });
    expect(await billing(acme.id)).toMatchObject({ plan: "FREE", status: null });
    expect(await getDb().stripeEvent.count()).toBe(0);
  });

  it("applies a redelivered event only once", async () => {
    const { subscription } = await subscribe();
    fakeStripe.update(subscription.id, { priceId: PRICES.STRIPE_PRICE_AGENCY_MONTHLY });
    const event = subscriptionEvent(subscription);
    const first = await postWebhook("customer.subscription.updated", event, {
      id: "evt_duplicate",
    });
    const second = await postWebhook("customer.subscription.updated", event, {
      id: "evt_duplicate",
    });
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await getDb().stripeEvent.count({ where: { id: "evt_duplicate" } })).toBe(1);
    expect(
      (await auditActions(acme.id)).filter((action) => action === "billing.plan_changed"),
    ).toHaveLength(1);
    expect(await billing(acme.id)).toMatchObject({ plan: "AGENCY" });
  });

  it("ignores events for customers ClientFlow did not create", async () => {
    await subscribe();
    const before = await billing(acme.id);
    const result = await postWebhook("customer.subscription.updated", {
      id: "sub_unknown",
      object: "subscription",
      customer: "cus_unknown",
    });
    expect(result.status).toBe(200);
    expect(await billing(acme.id)).toEqual(before);
  });

  it("ignores a checkout whose organization reference does not match its customer (cross-organization)", async () => {
    // Globex's billing admin starts checkout; the event claims it is for Acme.
    actAs(outsider.cookie);
    const started = await startCheckoutAction("globex", { plan: "AGENCY", interval: "MONTH" });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.data.url.split("/").pop()!;
    const subscription = fakeStripe.completeCheckout(sessionId);
    await postWebhook("checkout.session.completed", {
      id: sessionId,
      object: "checkout.session",
      customer: subscription.customerId,
      subscription: subscription.id,
      client_reference_id: acme.id,
    });
    expect(await billing(acme.id)).toBeNull();
    expect(await billing(globex.id)).toMatchObject({ plan: "FREE", status: null });

    // The subscription event (resolved through Globex's own customer) applies to Globex only.
    await postWebhook("customer.subscription.created", subscriptionEvent(subscription));
    expect(await billing(globex.id)).toMatchObject({ plan: "AGENCY", status: "ACTIVE" });
    expect(await billing(acme.id)).toBeNull();
  });

  it("grants nothing for a subscription on an unknown (forged) Price", async () => {
    actAs(members.OWNER.cookie);
    const started = await startCheckoutAction("acme", { plan: "STARTER", interval: "MONTH" });
    if (!started.ok) throw new Error(started.error.message);
    const subscription = fakeStripe.completeCheckout(started.data.url.split("/").pop()!, {
      priceId: "price_forged",
    });
    await postWebhook("customer.subscription.created", subscriptionEvent(subscription));
    expect(await billing(acme.id)).toMatchObject({ plan: "FREE", status: "ACTIVE" });
    expect((await getBillingOverview(getTenantDb(acme.id))).entitlements.plan).toBe("FREE");
  });

  it("reads the current state from Stripe, so a late event cannot roll back a cancellation", async () => {
    const { subscription } = await subscribe();
    fakeStripe.update(subscription.id, { status: "CANCELED" });
    await postWebhook("customer.subscription.deleted", subscriptionEvent(subscription));
    // A delayed "updated" event from before the cancellation arrives last.
    await postWebhook("customer.subscription.updated", subscriptionEvent(subscription));
    expect(await billing(acme.id)).toMatchObject({ plan: "FREE", status: "CANCELED" });
  });

  it("returns 503 when billing is not configured", async () => {
    clearBillingEnv();
    vi.resetModules();
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(
      webhookRequest("customer.subscription.updated", { object: "subscription" }),
    );
    expect(response.status).toBe(503);
    vi.unstubAllEnvs();
  });
});

describe("plan changes", () => {
  it("upgrades an active subscription (applied from Stripe's state) and audits who asked", async () => {
    const { subscription } = await subscribe("STARTER", "MONTH");
    actAs(members.ADMIN.cookie);
    expect(await changePlanAction("acme", { plan: "AGENCY", interval: "YEAR" })).toEqual({
      ok: true,
      data: null,
    });
    expect(fakeStripe.subscriptions.get(subscription.id)?.priceId).toBe(
      PRICES.STRIPE_PRICE_AGENCY_ANNUAL,
    );
    expect(await billing(acme.id)).toMatchObject({
      plan: "AGENCY",
      interval: "YEAR",
      status: "ACTIVE",
    });
    const requested = await getDb().auditLog.findFirstOrThrow({
      where: { organizationId: acme.id, action: "billing.plan_change_requested" },
    });
    expect(requested.actorUserId).toBe(members.ADMIN.userId);
    expect(await auditActions(acme.id)).toEqual([
      "billing.checkout_started",
      "billing.subscription_activated",
      "billing.plan_change_requested",
      "billing.plan_changed",
    ]);
  });

  it("downgrades keep all records and only limit new ones", async () => {
    await subscribe("GROWTH", "MONTH");
    await getDb().client.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({
        organizationId: acme.id,
        name: `C${index}`,
      })),
    });
    actAs(members.OWNER.cookie);
    expect(await changePlanAction("acme", { plan: "STARTER", interval: "MONTH" })).toMatchObject({
      ok: true,
    });
    expect(await getDb().client.count({ where: { organizationId: acme.id } })).toBe(20);
    const overview = await getBillingOverview(getTenantDb(acme.id));
    expect(overview.usage.clients).toMatchObject({ used: 20, limit: 15, overBy: 5 });
    actAs(members.MANAGER.cookie);
    expect(await createClientAction("acme", { name: "Over" })).toMatchObject({
      ok: false,
      error: { details: { limit: 15, used: 20 } },
    });
  });

  it("refuses changes without an active subscription or to the current plan", async () => {
    actAs(members.OWNER.cookie);
    expect(await changePlanAction("acme", { plan: "AGENCY", interval: "MONTH" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });
    await subscribe("GROWTH", "MONTH");
    actAs(members.OWNER.cookie);
    expect(await changePlanAction("acme", { plan: "GROWTH", interval: "MONTH" })).toMatchObject({
      ok: false,
      error: { code: "CONFLICT", message: "You are already on the Growth plan." },
    });
  });

  it.each(["MANAGER", "MEMBER"] as const)(
    "%s cannot change, cancel or resume the plan",
    async (role) => {
      await subscribe();
      actAs(members[role].cookie);
      for (const result of [
        await changePlanAction("acme", { plan: "AGENCY", interval: "MONTH" }),
        await cancelSubscriptionAction("acme", {}),
        await resumeSubscriptionAction("acme", {}),
      ]) {
        expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      }
      expect(await billing(acme.id)).toMatchObject({ plan: "GROWTH", cancelAtPeriodEnd: false });
    },
  );
});

describe("cancellation and payment failures", () => {
  it("cancels at period end (keeping the plan until then), can be withdrawn, then ends on Stripe's word", async () => {
    const { subscription } = await subscribe();
    actAs(members.OWNER.cookie);
    expect(await cancelSubscriptionAction("acme", {})).toEqual({ ok: true, data: null });
    expect(await billing(acme.id)).toMatchObject({
      plan: "GROWTH",
      status: "ACTIVE",
      cancelAtPeriodEnd: true,
    });

    expect(await resumeSubscriptionAction("acme", {})).toEqual({ ok: true, data: null });
    expect(await billing(acme.id)).toMatchObject({ cancelAtPeriodEnd: false });

    await cancelSubscriptionAction("acme", {});
    fakeStripe.update(subscription.id, { status: "CANCELED" });
    await postWebhook("customer.subscription.deleted", subscriptionEvent(subscription));
    expect(await billing(acme.id)).toMatchObject({
      plan: "FREE",
      status: "CANCELED",
      cancelAtPeriodEnd: false,
    });
    expect(await auditActions(acme.id)).toEqual(
      expect.arrayContaining([
        "billing.cancellation_requested",
        "billing.cancellation_withdrawn",
        "billing.subscription_cancelled",
      ]),
    );
    // Cancelled: a new checkout is possible again.
    actAs(members.OWNER.cookie);
    expect(await startCheckoutAction("acme", { plan: "STARTER", interval: "MONTH" })).toMatchObject(
      { ok: true },
    );
  });

  it("keeps the plan while a failed payment is retried, then falls back to Free when unpaid", async () => {
    const { subscription } = await subscribe("PROFESSIONAL", "MONTH");
    fakeStripe.update(subscription.id, { status: "PAST_DUE" });
    await postWebhook("invoice.payment_failed", {
      id: "in_1",
      object: "invoice",
      customer: subscription.customerId,
    });
    expect(await billing(acme.id)).toMatchObject({ plan: "PROFESSIONAL", status: "PAST_DUE" });
    expect((await getBillingOverview(getTenantDb(acme.id))).entitlements.plan).toBe("PROFESSIONAL");
    const failed = await getDb().auditLog.findFirstOrThrow({
      where: { organizationId: acme.id, action: "billing.payment_failed" },
    });
    expect(failed.actorUserId).toBeNull();

    fakeStripe.update(subscription.id, { status: "UNPAID" });
    await postWebhook("customer.subscription.updated", subscriptionEvent(subscription));
    expect((await getBillingOverview(getTenantDb(acme.id))).entitlements.plan).toBe("FREE");
    expect(await auditActions(acme.id)).toContain("billing.subscription_status_changed");

    // Paid again: the plan comes back.
    fakeStripe.update(subscription.id, { status: "ACTIVE" });
    await postWebhook("invoice.paid", {
      id: "in_2",
      object: "invoice",
      customer: subscription.customerId,
    });
    expect((await getBillingOverview(getTenantDb(acme.id))).entitlements.plan).toBe("PROFESSIONAL");
  });

  it("a first payment that fails grants nothing", async () => {
    actAs(members.OWNER.cookie);
    const started = await startCheckoutAction("acme", { plan: "AGENCY", interval: "MONTH" });
    if (!started.ok) throw new Error(started.error.message);
    const subscription = fakeStripe.completeCheckout(started.data.url.split("/").pop()!, {
      status: "INCOMPLETE",
    });
    await postWebhook("customer.subscription.created", subscriptionEvent(subscription));
    expect(await billing(acme.id)).toMatchObject({ plan: "AGENCY", status: "INCOMPLETE" });
    expect((await getBillingOverview(getTenantDb(acme.id))).entitlements.plan).toBe("FREE");
  });
});

describe("checkout return page (success URL)", () => {
  it("applies this organization's own completed session", async () => {
    actAs(members.OWNER.cookie);
    const started = await startCheckoutAction("acme", { plan: "GROWTH", interval: "MONTH" });
    if (!started.ok) throw new Error(started.error.message);
    const sessionId = started.data.url.split("/").pop()!;
    fakeStripe.completeCheckout(sessionId);
    expect(await syncCheckoutSession(acme.id, sessionId, fakeStripe.provider)).toBe(true);
    expect(await billing(acme.id)).toMatchObject({ plan: "GROWTH", status: "ACTIVE" });
  });

  it("does nothing for a forged, unpaid or other organization's session", async () => {
    actAs(members.OWNER.cookie);
    const acmeStarted = await startCheckoutAction("acme", { plan: "STARTER", interval: "MONTH" });
    if (!acmeStarted.ok) throw new Error(acmeStarted.error.message);
    const unpaid = acmeStarted.data.url.split("/").pop()!;
    actAs(outsider.cookie);
    const globexStarted = await startCheckoutAction("globex", {
      plan: "AGENCY",
      interval: "MONTH",
    });
    if (!globexStarted.ok) throw new Error(globexStarted.error.message);
    const globexSession = globexStarted.data.url.split("/").pop()!;
    fakeStripe.completeCheckout(globexSession);

    expect(await syncCheckoutSession(acme.id, "cs_test_forged000000000", fakeStripe.provider)).toBe(
      false,
    );
    expect(await syncCheckoutSession(acme.id, unpaid, fakeStripe.provider)).toBe(false);
    expect(await syncCheckoutSession(acme.id, globexSession, fakeStripe.provider)).toBe(false);
    expect(await billing(acme.id)).toMatchObject({ plan: "FREE", status: null });
    expect(await billing(globex.id)).toMatchObject({ plan: "FREE", status: null });
  });
});
