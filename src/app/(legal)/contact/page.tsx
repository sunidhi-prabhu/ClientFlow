import { type Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { BUSINESS } from "@/config/business";

export const metadata: Metadata = { title: "Contact Us" };

export default function ContactPage() {
  return (
    <LegalPage title="Contact Us">
      <LegalSection title="Get in touch">
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-[max-content_1fr]">
          <dt className="font-medium">Business</dt>
          <dd>
            {BUSINESS.productName}, operated by {BUSINESS.legalName} (
            {BUSINESS.entityType.toLowerCase()})
          </dd>
          <dt className="font-medium">Email</dt>
          <dd>
            <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a>
          </dd>
          <dt className="font-medium">Location</dt>
          <dd>
            {BUSINESS.city}, {BUSINESS.state}, {BUSINESS.country}
          </dd>
          {BUSINESS.gstin && (
            <>
              <dt className="font-medium">GSTIN</dt>
              <dd>{BUSINESS.gstin}</dd>
            </>
          )}
          <dt className="font-medium">Response time</dt>
          <dd>We reply {BUSINESS.responseTime}.</dd>
        </dl>
      </LegalSection>
      <LegalSection title="Support, billing and privacy requests">
        <p>
          Use the email above for help with your account, questions about payments, cancellations
          and refunds, and privacy requests or grievances.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
