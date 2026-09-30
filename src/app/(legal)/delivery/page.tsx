import { type Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { BUSINESS } from "@/config/business";

export const metadata: Metadata = { title: "Delivery Policy" };

export default function DeliveryPage() {
  return (
    <LegalPage title="Delivery Policy">
      <LegalSection title="Online service, no physical delivery">
        <p>
          {BUSINESS.productName} is a software service used in your web browser. Nothing is shipped;
          there are no delivery charges.
        </p>
      </LegalSection>

      <LegalSection title="When you get access">
        <ul>
          <li>Your account is available as soon as you confirm your email address.</li>
          <li>
            A paid plan is applied to your organization as soon as Razorpay confirms the payment,
            usually within a few minutes.
          </li>
          <li>
            If a confirmed payment is not reflected within 24 hours, email{" "}
            <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a> and we will
            resolve it.
          </li>
        </ul>
      </LegalSection>
    </LegalPage>
  );
}
