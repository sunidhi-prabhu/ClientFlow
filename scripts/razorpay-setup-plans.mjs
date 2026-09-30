#!/usr/bin/env node
/**
 * Create ClientFlow's 8 subscription plans in your Razorpay account (USD,
 * monthly + yearly for Starter, Growth, Professional and Agency) and print the
 * RAZORPAY_PLAN_* lines for .env / Vercel. Plans charge the price plus 18% GST
 * (e.g. $9 + $1.62 = $10.62), the total ClientFlow shows at checkout.
 *
 *   npm run billing:setup-plans            # test mode (rzp_test_ keys from .env)
 *   npm run billing:setup-plans -- --live  # live mode (rzp_live_ keys)
 *
 * Safe to run again: plans it created before (tagged in their notes) are
 * reused, never duplicated. Amounts must match src/lib/billing.ts (price +
 * GST_RATE_BPS), which ClientFlow re-checks before every checkout.
 */
import "dotenv/config";

const PLANS = [
  ["STARTER", "Starter", 900, 9_000],
  ["GROWTH", "Growth", 1_900, 19_000],
  ["PROFESSIONAL", "Professional", 3_900, 39_000],
  ["AGENCY", "Agency", 7_900, 79_000],
];
/** 18% GST in basis points, half-up to the cent (same as src/lib/billing.ts). */
const GST_RATE_BPS = 1800n;
const withGst = (cents) => {
  const tax = Number((BigInt(cents) * GST_RATE_BPS * 2n + 10_000n) / 20_000n);
  return { tax, total: cents + tax };
};

const INTERVALS = [
  ["MONTH", "MONTHLY", "monthly"],
  ["YEAR", "ANNUAL", "yearly"],
];

const keyId = process.env.RAZORPAY_KEY_ID;
const keySecret = process.env.RAZORPAY_KEY_SECRET;
const live = process.argv.includes("--live");

if (!keyId || !keySecret) {
  console.error(
    "Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env first (Razorpay Dashboard → Account & Settings → API Keys).",
  );
  process.exit(1);
}
if (keyId.startsWith("rzp_live_") && !live) {
  console.error("These are LIVE keys. Re-run with --live if you really want to create live plans.");
  process.exit(1);
}

const auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`;

async function api(method, path, body) {
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    method,
    headers: { authorization: auth, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${method} ${path} failed (${response.status}): ${data.error?.description ?? response.statusText}`,
    );
  }
  return data;
}

async function existingPlans() {
  const found = new Map();
  for (let skip = 0; ; skip += 100) {
    const page = await api("GET", `/plans?count=100&skip=${skip}`);
    for (const plan of page.items ?? []) {
      const tag = plan.notes?.clientflow;
      if (tag && !found.has(tag)) found.set(tag, plan);
    }
    if ((page.items ?? []).length < 100) return found;
  }
}

try {
  const existing = await existingPlans();
  const lines = [];
  for (const [plan, name, monthly, yearly] of PLANS) {
    for (const [interval, suffix, period] of INTERVALS) {
      const price = interval === "MONTH" ? monthly : yearly;
      const { tax, total: amount } = withGst(price);
      const tag = `${plan}_${interval}`;
      let found = existing.get(tag);
      if (found && (found.item.amount !== amount || found.item.currency !== "USD")) {
        console.error(
          `Existing plan ${found.id} (${tag}) has the wrong price; create a new one in the dashboard or remove its "clientflow" note.`,
        );
        process.exit(1);
      }
      if (!found) {
        found = await api("POST", "/plans", {
          period,
          interval: 1,
          item: {
            name: `ClientFlow ${name} (${interval === "MONTH" ? "monthly" : "annual"})`,
            amount,
            currency: "USD",
            description: `${name} plan, billed ${period}: $${(price / 100).toFixed(2)} + $${(tax / 100).toFixed(2)} GST (18%)`,
          },
          notes: { clientflow: tag },
        });
        console.log(
          `Created ${found.id}  ${name} ${period}  $${(amount / 100).toFixed(2)} incl. GST`,
        );
      } else {
        console.log(
          `Reusing ${found.id}  ${name} ${period}  $${(amount / 100).toFixed(2)} incl. GST`,
        );
      }
      lines.push(`RAZORPAY_PLAN_${plan}_${suffix}="${found.id}"`);
    }
  }
  console.log("\nAdd these lines to .env (and to Vercel for production):\n");
  console.log(lines.join("\n"));
} catch (error) {
  console.error(error.message);
  if (/currency|international/i.test(error.message)) {
    console.error(
      "\nUSD plans need International Payments enabled on your Razorpay account (Dashboard → Account & Settings → International payments).",
    );
  }
  process.exit(1);
}
