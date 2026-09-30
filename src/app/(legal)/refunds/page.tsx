import { type Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { BUSINESS } from "@/config/business";

export const metadata: Metadata = { title: "Cancellation and Refund Policy" };

export default function RefundsPage() {
  const email = <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a>;
  return (
    <LegalPage title="Cancellation and Refund Policy">
      <LegalSection title="Cancel anytime">
        <p>
          Organization owners and admins can cancel a paid plan at any time from{" "}
          <strong>Billing → Downgrade to Free</strong>. The paid plan stays active until the end of
          the period already paid for; after that the organization moves to the Free plan and no
          further payments are taken. Cancelling never deletes your data.
        </p>
      </LegalSection>

      <LegalSection title="Refunds">
        <p>
          Payments are non-refundable, including for partially used billing periods, because access
          continues until the end of the period you paid for.
        </p>
        <p>
          If you were charged twice or incorrectly, email {email} with the payment details. We
          refund confirmed billing errors in full to the original payment method; refunds usually
          reach you within 5 to 7 business days of approval, depending on your bank.
        </p>
      </LegalSection>

      <LegalSection title="Plan changes">
        <ul>
          <li>Upgrades are charged, including GST, and apply once the payment is confirmed.</li>
          <li>Downgrades apply at the end of the current billing period, without refunds.</li>
        </ul>
      </LegalSection>

      <LegalSection title="Contact">
        <p>
          Questions about cancellations or refunds: {email}. We respond {BUSINESS.responseTime}.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
