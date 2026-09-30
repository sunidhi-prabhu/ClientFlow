/**
 * The business behind ClientFlow, shown on the legal and contact pages
 * (/terms, /privacy, /refunds, /delivery, /contact) and required by the
 * payment provider's website review. Keep it accurate.
 */
export const BUSINESS = {
  /** The legal owner (a sole proprietor, in their own name). */
  legalName: "Sunidhi Prabhu",
  entityType: "Sole proprietor",
  productName: "ClientFlow",
  supportEmail: "sunidhiprabhu07@gmail.com",
  city: "Bengaluru",
  state: "Karnataka",
  country: "India",
  /** GST registration number. Required before GST may be charged; shown when set. */
  gstin: null as string | null,
  /** Response time promised on the contact page. */
  responseTime: "within 2 business days",
  /** Date the policies were last changed (update when editing their text). */
  policiesUpdated: "30 September 2026",
} as const;

export const LEGAL_PAGES = [
  { href: "/terms", title: "Terms and Conditions" },
  { href: "/privacy", title: "Privacy Policy" },
  { href: "/refunds", title: "Cancellation and Refund Policy" },
  { href: "/delivery", title: "Delivery Policy" },
  { href: "/contact", title: "Contact Us" },
] as const;
