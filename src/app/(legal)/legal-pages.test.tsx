// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { SiteFooter } from "@/components/legal/site-footer";
import { BUSINESS, LEGAL_PAGES } from "@/config/business";

import ContactPage from "./contact/page";
import DeliveryPage from "./delivery/page";
import PrivacyPage from "./privacy/page";
import RefundsPage from "./refunds/page";
import TermsPage from "./terms/page";

afterEach(cleanup);

const pages = [
  ["Terms and Conditions", TermsPage],
  ["Privacy Policy", PrivacyPage],
  ["Cancellation and Refund Policy", RefundsPage],
  ["Delivery Policy", DeliveryPage],
  ["Contact Us", ContactPage],
] as const;

describe("policy pages", () => {
  it.each(pages)("%s has its title, date and the support email", (title, Page) => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(title);
    expect(screen.getByText(`Last updated ${BUSINESS.policiesUpdated}`)).toBeVisible();
    const mail = screen.getAllByRole("link", { name: BUSINESS.supportEmail });
    expect(mail.length).toBeGreaterThan(0);
    for (const link of mail) {
      expect(link).toHaveAttribute("href", `mailto:${BUSINESS.supportEmail}`);
    }
  });

  it("contact page shows the operator, email and location", () => {
    render(<ContactPage />);
    expect(document.body).toHaveTextContent(`operated by ${BUSINESS.legalName} (sole proprietor)`);
    expect(document.body).toHaveTextContent(
      `${BUSINESS.city}, ${BUSINESS.state}, ${BUSINESS.country}`,
    );
    expect(screen.getByRole("link", { name: BUSINESS.supportEmail })).toBeVisible();
  });

  it("terms state USD prices plus 18% GST and Razorpay as processor", () => {
    render(<TermsPage />);
    expect(document.body).toHaveTextContent(
      "Prices are in US dollars. 18% GST is added to every paid plan",
    );
    expect(document.body).toHaveTextContent("Payments are processed by Razorpay");
  });

  it("refund policy: cancel anytime, no refunds, billing errors refunded", () => {
    render(<RefundsPage />);
    expect(document.body).toHaveTextContent("cancel a paid plan at any time");
    expect(document.body).toHaveTextContent("Payments are non-refundable");
    expect(document.body).toHaveTextContent("charged twice or incorrectly");
  });

  it("the footer links every policy page", () => {
    render(<SiteFooter />);
    const nav = screen.getByRole("navigation", { name: "Policies" });
    expect(
      within(nav)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(LEGAL_PAGES.map((page) => page.href));
  });
});
