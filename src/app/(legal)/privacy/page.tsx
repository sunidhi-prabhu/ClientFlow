import { type Metadata } from "next";

import { LegalPage, LegalSection } from "@/components/legal/legal-page";
import { BUSINESS } from "@/config/business";

export const metadata: Metadata = { title: "Privacy Policy" };

export default function PrivacyPage() {
  const email = <a href={`mailto:${BUSINESS.supportEmail}`}>{BUSINESS.supportEmail}</a>;
  return (
    <LegalPage title="Privacy Policy">
      <LegalSection title="Who we are">
        <p>
          {BUSINESS.productName} is operated by {BUSINESS.legalName} (
          {BUSINESS.entityType.toLowerCase()}), {BUSINESS.city}, {BUSINESS.state},{" "}
          {BUSINESS.country}. We are responsible for the personal data described here. Contact:{" "}
          {email}.
        </p>
      </LegalSection>

      <LegalSection title="What we collect">
        <ul>
          <li>
            <strong>Account details:</strong> your name and email address. Your password is stored
            only as a one-way hash. If you sign in with Google, we receive your name, email address
            and profile picture from Google.
          </li>
          <li>
            <strong>Content you enter:</strong> organizations, members and roles, clients and their
            contact details, projects, tasks and invoices.
          </li>
          <li>
            <strong>Billing:</strong> your organization&apos;s plan, subscription status and
            Razorpay subscription reference. Card and bank details are collected and stored by
            Razorpay, never by us.
          </li>
          <li>
            <strong>Security records:</strong> IP address and browser information for sign-in
            sessions and abuse protection, and an audit log of important actions (such as sign-ins
            and changes to records) visible to organization owners and admins.
          </li>
        </ul>
      </LegalSection>

      <LegalSection title="How we use it">
        <ul>
          <li>to provide and secure the service and your organization&apos;s workspace;</li>
          <li>to send account emails (verification codes, password resets);</li>
          <li>to manage subscriptions and billing;</li>
          <li>to meet legal, tax and accounting obligations.</li>
        </ul>
        <p>We do not sell your data and do not use it for advertising.</p>
      </LegalSection>

      <LegalSection title="Cookies">
        <p>
          We use only an essential cookie that keeps you signed in. We do not use analytics or
          advertising cookies.
        </p>
      </LegalSection>

      <LegalSection title="Service providers">
        <p>We share data only with providers that help run the service:</p>
        <ul>
          <li>Vercel (application hosting);</li>
          <li>Neon (database hosting, Singapore region);</li>
          <li>Razorpay (payment processing);</li>
          <li>Google (sending account emails, and Google sign-in if you use it).</li>
        </ul>
      </LegalSection>

      <LegalSection title="Retention and deletion">
        <p>
          We keep your data while your account or organization is active. You can ask us to delete
          your account or organization by emailing {email}; we will do so within 30 days, except
          records we must keep by law (for example billing and tax records).
        </p>
      </LegalSection>

      <LegalSection title="Security">
        <p>
          Data is encrypted in transit (HTTPS/TLS). Each organization&apos;s data is isolated from
          other organizations, and access is limited by role.
        </p>
      </LegalSection>

      <LegalSection title="Your rights">
        <p>
          Under India&apos;s Digital Personal Data Protection Act, 2023 and other applicable laws,
          you can ask to access, correct or erase your personal data, withdraw consent, or raise a
          grievance. Email {email}; we respond {BUSINESS.responseTime}.
        </p>
      </LegalSection>

      <LegalSection title="Changes">
        <p>
          We may update this policy; the date above shows the latest version. Material changes are
          notified to account owners by email.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
