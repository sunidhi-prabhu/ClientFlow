import { beforeEach, describe, expect, it, vi } from "vitest";

import { POST as webhook } from "@/app/api/billing/webhook/route";
import {
  cancelSubscriptionAction,
  changePlanAction,
  startCheckoutAction,
} from "@/app/o/[orgSlug]/billing/actions";
import { createClientAction } from "@/app/o/[orgSlug]/clients/actions";
import { type MembershipRole } from "@/generated/prisma/enums";
import { type BillingInterval, type PaidPlan } from "@/lib/billing";
import { getDb } from "@/lib/db";
import type * as RazorpayModule from "@/server/billing/razorpay";
import { getBillingOverview, refreshBillingState } from "@/server/billing/service";
import { createOrganization } from "@/server/organizations/bootstrap";
import { tenantPage } from "@/server/protected";
import { getTenantDb } from "@/server/tenancy";
import { getTenantContext } from "@/server/tenancy/context";

import { TEST_BILLING_ENV as PLAN_IDS } from "../support/billing-config";
import { clearBillingEnv } from "../support/billing-env";
import { createVerifiedUser } from "./support/auth";
import { fakeRazorpay, webhookRequest } from "./support/fake-razorpay";
import { actAs } from "./support/next-request";

vi.mock("next/headers", async () => (await import("./support/next-request")).nextHeaders);
// Razorpay is replaced by an in-memory fake; webhook signatures are still
// verified by the real verification code.
vi.mock("@/server/billing/razorpay", async (importOriginal) => {
  const actual = await importOriginal<typeof RazorpayModule>();
  const { fakeRazorpay: fake } = await import("./support/fake-razorpay");
  const { TEST_BILLING_ENV } = await import("../support/billing-config");
  fake.verifier = (payload: string, signature: string | null, eventId: string | null) =>
    actual.verifyRazorpayWebhook(
      payload,
      signature,
      eventId,
      TEST_BILLING_ENV.RAZORPAY_WEBHOOK_SECRET,
    );
  return { ...actual, razorpayBillingProvider: fake.provider };
});

type Member = { userId: string; cookie: string };
let acme: { id: string; slug: string };
let globex: { id: string; slug: string };
const members = {} as Record<MembershipRole, Member>;
let outsider: Member;

const billing = (organizationId: string) =>
  getDb().subscription.findUnique({ where: { organizationId } });
const effectivePlan = async (organizationId: string) =>
  (await getBillingOverview(getTenantDb(organizationId))).entitlements.plan;
const auditActions = async (organizationId: string) =>
  (
    await getDb().auditLog.findMany({
      where: { organizationId, action: { startsWith: "billing." } },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { action: true },
    })
  ).map((row) => row.action);

async function postWebhook(...args: Parameters<typeof webhookRequest>) {
  const response = await webhook(webhookRequest(...args));
  return { status: response.status, body: await response.json() };
}

/** Start checkout as `role` (default OWNER) and return the created Razorpay subscription id. */
async function checkout(
  plan: PaidPlan = "GROWTH",
  interval: BillingInterval = "MONTH",
  { slug = "acme", as = members.OWNER } = {},
) {
  actAs(as.cookie);
  const result = await startCheckoutAction(slug, { plan, interval });
  if (!result.ok) throw new Error(result.error.message);
  return result.data.url.split("/").pop()!;
}

/** Checkout, pay on "Razorpay", and deliver the activation webhook. */
async function subscribe(plan: PaidPlan = "GROWTH", interval: BillingInterval = "MONTH") {
  const subscriptionId = await checkout(plan, interval);
  fakeRazorpay.pay(subscriptionId);
  expect((await postWebhook("subscription.activated", subscriptionId)).status).toBe(200);
  return subscriptionId;
}

beforeEach(async () => {
  fakeRazorpay.reset();
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
  it("OWNER gets a Razorpay payment page for the server-configured plan; nothing is granted yet", async () => {
    actAs(members.OWNER.cookie);
    const result = await startCheckoutAction("acme", {
      plan: "GROWTH",
      interval: "YEAR",
      // Forged values: ignored.
      planId: "plan_startermonthly",
      organizationId: globex.id,
      clientLimit: 10_000,
    });
    expect(result).toMatchObject({
      ok: true,
      data: { url: expect.stringMatching(/^https:\/\/rzp\.test\/i\/sub_/) },
    });
    expect(fakeRazorpay.created).toEqual([
      { planId: PLAN_IDS.RAZORPAY_PLAN_GROWTH_ANNUAL, organizationId: acme.id, totalCount: 10 },
    ]);
    const subscriptionId = fakeRazorpay.created.length && [...fakeRazorpay.subscriptions.keys()][0];
    expect(await billing(acme.id)).toMatchObject({
      plan: "FREE",
      status: "INCOMPLETE",
      providerSubscriptionId: subscriptionId,
    });
    expect(await effectivePlan(acme.id)).toBe("FREE");
    expect(await billing(globex.id)).toBeNull();
    expect(await auditActions(acme.id)).toEqual(["billing.checkout_started"]);
    const started = await getDb().auditLog.findFirstOrThrow({
      where: { organizationId: acme.id, action: "billing.checkout_started" },
    });
    expect(started.metadata).toMatchObject({
      plan: "GROWTH",
      interval: "YEAR",
      priceCents: 19_000,
      taxCents: 3_420,
      totalCents: 22_420,
    });
  });

  it("monthly subscriptions run 120 cycles, annual 10", async () => {
    await checkout("STARTER", "MONTH");
    expect(fakeRazorpay.created.at(-1)).toMatchObject({ totalCount: 120 });
  });

  it("ADMIN may start checkout; an unpaid earlier checkout is replaced and cancelled", async () => {
    const first = await checkout("STARTER", "MONTH", { as: members.ADMIN });
    const second = await checkout("AGENCY", "MONTH", { as: members.ADMIN });
    expect(fakeRazorpay.cancellations).toEqual([{ subscriptionId: first, atCycleEnd: false }]);
    expect(await billing(acme.id)).toMatchObject({
      providerSubscriptionId: second,
      status: "INCOMPLETE",
    });
    // Paying the abandoned link later changes nothing.
    fakeRazorpay.pay(first);
    await postWebhook("subscription.activated", first);
    expect(await billing(acme.id)).toMatchObject({ providerSubscriptionId: second, plan: "FREE" });
  });

  it.each(["MANAGER", "MEMBER"] as const)(
    "%s cannot start checkout (403, nothing created)",
    async (role) => {
      actAs(members[role].cookie);
      // Even with a forged role in the payload.
      expect(
        await startCheckoutAction("acme", { plan: "GROWTH", interval: "MONTH", role: "OWNER" }),
      ).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
      expect(fakeRazorpay.created).toEqual([]);
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
    expect(fakeRazorpay.created).toEqual([]);
  });

  it.each([
    [{ plan: "ENTERPRISE", interval: "MONTH" }],
    [{ plan: "FREE", interval: "MONTH" }],
    [{ plan: "GROWTH", interval: "DAY" }],
    [{ planId: "plan_growthmonthly" }],
  ])("rejects forged plan input %j", async (input) => {
    actAs(members.OWNER.cookie);
    expect(await startCheckoutAction("acme", input)).toMatchObject({
      ok: false,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(fakeRazorpay.created).toEqual([]);
  });

  it.each([
    ["a different amount", { amount: 100 }],
    ["the price without GST", { amount: 1_900 }],
    ["another currency", { currency: "INR" }],
    ["another period", { period: "weekly" }],
  ])("never charges a Razorpay plan with %s than published", async (_label, change) => {
    const id = PLAN_IDS.RAZORPAY_PLAN_GROWTH_MONTHLY;
    fakeRazorpay.plans.set(id, { ...fakeRazorpay.plans.get(id)!, ...change });
    actAs(members.OWNER.cookie);
    expect(await startCheckoutAction("acme", { plan: "GROWTH", interval: "MONTH" })).toMatchObject({
      ok: false,
      error: { code: "SERVICE_UNAVAILABLE", message: "This plan is not available right now" },
    });
    expect(fakeRazorpay.created).toEqual([]);
  });

  it("refuses a second subscription while one is active", async () => {
    await subscribe();
    actAs(members.OWNER.cookie);
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

  it("refreshing re-reads only the organization's own stored subscription", async () => {
    const subscriptionId = await checkout();
    fakeRazorpay.pay(subscriptionId); // paid, but no webhook delivered (e.g. local development)
    actAs(members.OWNER.cookie);
    await refreshBillingState(await getTenantContext("acme"));
    expect(await billing(acme.id)).toMatchObject({ plan: "GROWTH", status: "ACTIVE" });
    // Globex has nothing to refresh, and cannot pick up Acme's subscription.
    actAs(outsider.cookie);
    await refreshBillingState(await getTenantContext("globex"));
    expect(await billing(globex.id)).toBeNull();
  });
});

describe("webhooks", () => {
  it("activates the paid plan from a verified subscription.activated event", async () => {
    const subscriptionId = await subscribe("GROWTH", "MONTH");
    expect(await billing(acme.id)).toMatchObject({
      plan: "GROWTH",
      interval: "MONTH",
      status: "ACTIVE",
      providerSubscriptionId: subscriptionId,
      currentPeriodEnd: new Date(Date.UTC(2030, 0, 1)),
    });
    expect((await getBillingOverview(getTenantDb(acme.id))).entitlements).toEqual({
      plan: "GROWTH",
      limits: { clients: 50, projects: 50 },
    });
    const activated = await getDb().auditLog.findFirstOrThrow({
      where: { organizationId: acme.id, action: "billing.subscription_activated" },
    });
    expect(activated).toMatchObject({ actorUserId: null, resourceId: subscriptionId });

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
    ["a signature made with another secret", { secret: "attacker-secret-attacker" }],
    ["a malformed signature", { signature: "not-hex" }],
    ["no event id", { eventId: null }],
  ])("rejects %s with 400 and changes nothing", async (_label, options) => {
    const subscriptionId = await checkout("AGENCY", "YEAR");
    fakeRazorpay.pay(subscriptionId);
    const result = await postWebhook("subscription.activated", subscriptionId, options);
    expect(result).toEqual({
      status: 400,
      body: { error: { code: "BAD_REQUEST", message: "Invalid signature" } },
    });
    expect(await billing(acme.id)).toMatchObject({ plan: "FREE", status: "INCOMPLETE" });
    expect(await getDb().billingEvent.count()).toBe(0);
  });

  it("rejects a tampered body even with a valid-looking signature", async () => {
    const subscriptionId = await checkout();
    const signed = webhookRequest("subscription.activated", subscriptionId);
    const body = (await signed.text()).replace(subscriptionId, "sub_other");
    const response = await webhook(
      new Request(signed.url, { method: "POST", headers: signed.headers, body }),
    );
    expect(response.status).toBe(400);
  });

  it("applies a redelivered event only once", async () => {
    const subscriptionId = await subscribe();
    fakeRazorpay.update(subscriptionId, { planId: PLAN_IDS.RAZORPAY_PLAN_AGENCY_MONTHLY });
    const first = await postWebhook("subscription.updated", subscriptionId, {
      eventId: "evt_duplicate",
    });
    const second = await postWebhook("subscription.updated", subscriptionId, {
      eventId: "evt_duplicate",
    });
    expect([first.status, second.status]).toEqual([200, 200]);
    expect(await getDb().billingEvent.count({ where: { id: "evt_duplicate" } })).toBe(1);
    expect(
      (await auditActions(acme.id)).filter((action) => action === "billing.plan_changed"),
    ).toHaveLength(1);
    expect(await billing(acme.id)).toMatchObject({ plan: "AGENCY" });
  });

  it("ignores events for subscriptions ClientFlow did not create", async () => {
    await subscribe();
    const before = await billing(acme.id);
    const result = await postWebhook("subscription.activated", "sub_unknown");
    expect(result.status).toBe(200);
    expect(await billing(acme.id)).toEqual(before);
  });

  it("never applies one organization's subscription to another (cross-organization)", async () => {
    const globexSubscription = await checkout("AGENCY", "MONTH", { slug: "globex", as: outsider });
    // Razorpay reports the subscription as Acme's (tampered notes): refused everywhere.
    fakeRazorpay.pay(globexSubscription);
    fakeRazorpay.update(globexSubscription, { organizationId: acme.id });
    await postWebhook("subscription.activated", globexSubscription);
    expect(await billing(acme.id)).toBeNull();
    expect(await billing(globex.id)).toMatchObject({ plan: "FREE", status: "INCOMPLETE" });

    fakeRazorpay.update(globexSubscription, { organizationId: globex.id });
    await postWebhook("subscription.activated", globexSubscription);
    expect(await billing(globex.id)).toMatchObject({ plan: "AGENCY", status: "ACTIVE" });
    expect(await billing(acme.id)).toBeNull();
  });

  it("grants nothing for a subscription on an unknown (forged) Razorpay plan", async () => {
    const subscriptionId = await checkout("STARTER", "MONTH");
    fakeRazorpay.pay(subscriptionId);
    fakeRazorpay.update(subscriptionId, { planId: "plan_forged" });
    await postWebhook("subscription.activated", subscriptionId);
    expect(await billing(acme.id)).toMatchObject({ plan: "FREE", status: "ACTIVE" });
    expect(await effectivePlan(acme.id)).toBe("FREE");
  });

  it("reads the current state from Razorpay, so a late event cannot roll back a cancellation", async () => {
    const subscriptionId = await subscribe();
    fakeRazorpay.update(subscriptionId, { status: "CANCELED" });
    await postWebhook("subscription.cancelled", subscriptionId);
    // A delayed "charged" event from before the cancellation arrives last.
    await postWebhook("subscription.charged", subscriptionId);
    expect(await billing(acme.id)).toMatchObject({ plan: "FREE", status: "CANCELED" });
  });

  it("returns 503 when billing is not configured", async () => {
    clearBillingEnv();
    vi.resetModules();
    const { POST } = await import("@/app/api/billing/webhook/route");
    const response = await POST(webhookRequest("subscription.activated", "sub_x"));
    expect(response.status).toBe(503);
    vi.unstubAllEnvs();
  });
});

describe("plan changes", () => {
  it("upgrades apply now (from Razorpay's state) and are audited with who asked", async () => {
    const subscriptionId = await subscribe("STARTER", "MONTH");
    actAs(members.ADMIN.cookie);
    expect(await changePlanAction("acme", { plan: "AGENCY", interval: "MONTH" })).toEqual({
      ok: true,
      data: { when: "now" },
    });
    expect(fakeRazorpay.planChanges).toEqual([
      { subscriptionId, planId: PLAN_IDS.RAZORPAY_PLAN_AGENCY_MONTHLY, when: "now" },
    ]);
    expect(await billing(acme.id)).toMatchObject({ plan: "AGENCY", status: "ACTIVE" });
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

  it("downgrades are scheduled for the end of the period, keep all records and only limit new ones", async () => {
    const subscriptionId = await subscribe("GROWTH", "MONTH");
    await getDb().client.createMany({
      data: Array.from({ length: 20 }, (_, index) => ({
        organizationId: acme.id,
        name: `C${index}`,
      })),
    });
    actAs(members.OWNER.cookie);
    expect(await changePlanAction("acme", { plan: "STARTER", interval: "MONTH" })).toEqual({
      ok: true,
      data: { when: "cycle_end" },
    });
    // Still Growth until the period ends; the change is shown as scheduled.
    expect(await billing(acme.id)).toMatchObject({ plan: "GROWTH", hasScheduledChange: true });
    expect(
      await changePlanAction("acme", { plan: "PROFESSIONAL", interval: "MONTH" }),
    ).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });

    // The period ends: Razorpay switches the plan.
    fakeRazorpay.update(subscriptionId, {
      planId: PLAN_IDS.RAZORPAY_PLAN_STARTER_MONTHLY,
      hasScheduledChange: false,
    });
    await postWebhook("subscription.updated", subscriptionId);
    expect(await billing(acme.id)).toMatchObject({ plan: "STARTER", hasScheduledChange: false });
    expect(await getDb().client.count({ where: { organizationId: acme.id } })).toBe(20);
    expect((await getBillingOverview(getTenantDb(acme.id))).usage.clients).toMatchObject({
      used: 20,
      limit: 15,
      overBy: 5,
    });
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

  it.each(["MANAGER", "MEMBER"] as const)("%s cannot change or cancel the plan", async (role) => {
    await subscribe();
    actAs(members[role].cookie);
    for (const result of [
      await changePlanAction("acme", { plan: "AGENCY", interval: "MONTH" }),
      await cancelSubscriptionAction("acme", {}),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: "FORBIDDEN" } });
    }
    expect(fakeRazorpay.planChanges).toEqual([]);
    expect(fakeRazorpay.cancellations).toEqual([]);
    expect(await billing(acme.id)).toMatchObject({ plan: "GROWTH", cancelAtPeriodEnd: false });
  });
});

describe("cancellation and payment failures", () => {
  it("cancels at period end (keeping the plan until then), then ends on Razorpay's word", async () => {
    const subscriptionId = await subscribe();
    actAs(members.OWNER.cookie);
    expect(await cancelSubscriptionAction("acme", {})).toEqual({ ok: true, data: null });
    expect(fakeRazorpay.cancellations).toEqual([{ subscriptionId, atCycleEnd: true }]);
    expect(await billing(acme.id)).toMatchObject({
      plan: "GROWTH",
      status: "ACTIVE",
      cancelAtPeriodEnd: true,
    });
    // Renewal-time events before the end do not forget the cancellation.
    await postWebhook("subscription.charged", subscriptionId);
    expect(await billing(acme.id)).toMatchObject({ cancelAtPeriodEnd: true });
    // No further plan changes or a second cancellation meanwhile.
    expect(await cancelSubscriptionAction("acme", {})).toMatchObject({
      ok: false,
      error: { code: "CONFLICT" },
    });

    fakeRazorpay.update(subscriptionId, { status: "CANCELED" });
    await postWebhook("subscription.cancelled", subscriptionId);
    expect(await billing(acme.id)).toMatchObject({
      plan: "FREE",
      status: "CANCELED",
      cancelAtPeriodEnd: false,
    });
    expect(await auditActions(acme.id)).toEqual(
      expect.arrayContaining(["billing.cancellation_requested", "billing.subscription_cancelled"]),
    );
    // Cancelled: a new checkout is possible again.
    expect(await checkout("STARTER", "MONTH")).toMatch(/^sub_/);
  });

  it("keeps the plan while a failed payment is retried, then falls back to Free when halted", async () => {
    const subscriptionId = await subscribe("PROFESSIONAL", "MONTH");
    fakeRazorpay.update(subscriptionId, { status: "PAST_DUE" });
    await postWebhook("subscription.pending", subscriptionId);
    expect(await billing(acme.id)).toMatchObject({ plan: "PROFESSIONAL", status: "PAST_DUE" });
    expect(await effectivePlan(acme.id)).toBe("PROFESSIONAL");
    const failed = await getDb().auditLog.findFirstOrThrow({
      where: { organizationId: acme.id, action: "billing.payment_failed" },
    });
    expect(failed.actorUserId).toBeNull();

    fakeRazorpay.update(subscriptionId, { status: "UNPAID" });
    await postWebhook("subscription.halted", subscriptionId);
    expect(await effectivePlan(acme.id)).toBe("FREE");
    expect(await auditActions(acme.id)).toContain("billing.subscription_status_changed");

    // Paid again: the plan comes back.
    fakeRazorpay.update(subscriptionId, { status: "ACTIVE" });
    await postWebhook("subscription.charged", subscriptionId);
    expect(await effectivePlan(acme.id)).toBe("PROFESSIONAL");
  });

  it("an unpaid checkout grants nothing", async () => {
    const subscriptionId = await checkout("AGENCY", "MONTH");
    await postWebhook("subscription.authenticated", subscriptionId);
    // The plan being paid for is recorded, but grants nothing until Razorpay reports it active.
    expect(await billing(acme.id)).toMatchObject({ plan: "AGENCY", status: "INCOMPLETE" });
    expect(await effectivePlan(acme.id)).toBe("FREE");
  });
});
