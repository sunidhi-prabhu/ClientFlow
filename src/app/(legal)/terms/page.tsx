import { type Metadata } from "next";
import Link from "next/link";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { BUSINESS } from "@/config/business";
import { GST_RATE_BPS } from "@/lib/billing";

export const metadata: Metadata = { title: "Terms and Conditions" };

export default function TermsPage() {
  return (
    <LegalPage title="Terms and Conditions">
      <LegalSection title="1. About these terms">
        <p>
          These terms govern your use of {BUSINESS.productName}, an online client, project, task and
          invoice management service operated by {BUSINESS.legalName} (
          {BUSINESS.entityType.toLowerCase()}), {BUSINESS.city}, {BUSINESS.state},{" "}
          {BUSINESS.country} (&quot;we&quot;, &quot;us&quot;). By creating an account you agree to
          them. Questions: <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a>.
        </p>
      </LegalSection>

      <LegalSection title="2. Accounts and organizations">
        <ul>
          <li>You must give accurate information and keep your password confidential.</li>
          <li>
            Work happens inside organizations. An organization&apos;s owners and admins decide who
            has access and are responsible for the members they add.
          </li>
          <li>You must be at least 18 years old to use {BUSINESS.productName}.</li>
        </ul>
      </LegalSection>

      <LegalSection title="3. Plans, prices and payment">
        <ul>
          <li>
            The Free plan and the paid plans (Starter, Growth, Professional and Agency) and their
            client and project limits are described on our{" "}
            <Link href="/#pricing">pricing page</Link>.
          </li>
          <li>
            Prices are in US dollars. {GST_RATE_BPS / 100}% GST is added to every paid plan; the
            total including GST is shown before you pay.
          </li>
          <li>
            Paid plans are subscriptions billed to the organization monthly or yearly in advance,
            and renew automatically until cancelled.
          </li>
          <li>Payments are processed by Razorpay. We never see or store your card details.</li>
          <li>
            If a renewal payment fails, Razorpay retries it. If it still cannot be collected, the
            organization moves to the Free plan&apos;s limits.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="4. Plan limits, upgrades and downgrades">
        <ul>
          <li>Upgrades apply as soon as the payment is confirmed.</li>
          <li>Downgrades apply at the end of the current billing period.</li>
          <li>
            A downgrade never deletes your data. If you are above the new plan&apos;s limits,
            existing clients and projects remain fully usable; only adding new ones is blocked until
            you are within the limits or upgrade again.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="5. Cancellation and refunds">
        <p>
          You can cancel at any time; see the{" "}
          <Link href="/refunds">Cancellation and Refund Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection title="6. Acceptable use">
        <p>You agree not to:</p>
        <ul>
          <li>use the service for anything unlawful, fraudulent or infringing;</li>
          <li>
            attempt to access other organizations&apos; data, bypass limits or security, or disrupt
            the service;
          </li>
          <li>resell or provide the service to others without our written permission.</li>
        </ul>
      </LegalSection>

      <LegalSection title="7. Your data">
        <p>
          You own the content you enter. We process it only to provide the service, as described in
          our <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </LegalSection>

      <LegalSection title="8. Availability and liability">
        <p>
          We work to keep {BUSINESS.productName} available and secure, but it is provided &quot;as
          is&quot; without guarantees of uninterrupted or error-free operation. To the extent
          permitted by law, our total liability for any claim is limited to the amount you paid us
          in the 12 months before the claim, and we are not liable for indirect or consequential
          losses.
        </p>
      </LegalSection>

      <LegalSection title="9. Suspension and termination">
        <p>
          You may stop using the service at any time. We may suspend or close accounts that breach
          these terms, after notice where reasonably possible.
        </p>
      </LegalSection>

      <LegalSection title="10. Changes">
        <p>
          We may update these terms; the date above shows the latest version. We will notify account
          owners by email of material changes before they take effect.
        </p>
      </LegalSection>

      <LegalSection title="11. Governing law">
        <p>
          These terms are governed by the laws of India. Courts at {BUSINESS.city}, {BUSINESS.state}{" "}
          have exclusive jurisdiction.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
