// HerdLedger site-wide configuration.
// Pricing lives HERE and only here; the landing page and the in-app plan
// screen both read from it. Change a price or feature line and redeploy.
export const BRAND = {
  name: "HerdLedger",
  tagline: "Know what every pen is worth — before the sale barn does.",
  supportEmail: "", // set when a support inbox exists
};

export const TRIAL_DAYS = 30;

export const PLANS = [
  {
    id: "standard",
    name: "Standard",
    price: 4.99,
    blurb: "The cattle books, done right.",
    features: [
      "Inventory by lot, unlimited head",
      "Expenses with per-head & per-cwt totals",
      "Breakeven and profit/loss per lot",
      "Daily equity history & chart",
      "End-of-day LE, GF & corn quotes",
      "CSV export & JSON backups",
    ],
  },
  {
    id: "select",
    name: "Select",
    price: 9.99,
    highlight: true,
    blurb: "Plan the feeding period, not just record it.",
    features: [
      "Everything in Standard",
      "Expense projections to sale date & weight",
      "Projected breakevens",
      "Futures position tracking & mark-to-market",
      "Printable lot & operation reports",
    ],
  },
  {
    id: "choice",
    name: "Choice",
    price: 14.99,
    blurb: "Full risk picture for hedgers.",
    features: [
      "Everything in Select",
      "Options: puts & calls with intrinsic value",
      "LRP endorsement tracking & est. indemnity",
      "Hedged vs. unhedged exposure dashboard",
      "Priority email support",
    ],
  },
];

// Phase 2 hooks. Leave null until Stripe / Supabase are wired up.
export const BILLING = {
  stripePublishableKey: null,
  checkoutUrls: { standard: null, select: null, choice: null },
};
export const BACKEND = { supabaseUrl: null, supabaseAnonKey: null };
