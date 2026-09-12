import { View, Text } from 'react-native';
import {
  CreditCard,
  UserCheck,
  AlertTriangle,
  Clock,
  Shield,
  Gavel,
  Globe,
  Mail,
  Building,
} from 'lucide-react-native';

const Section = ({
  icon,
  title,
  children,
  variant = 'white',
}: {
  icon?: React.ReactNode;
  title: string;
  children: React.ReactNode;
  variant?: 'white' | 'purple';
}) => (
  <View
    className={`rounded-2xl p-5 mb-4 border-2 ${
      variant === 'purple'
        ? 'bg-purple-50 border-[#8c76f0]/30'
        : 'bg-white border-gray-300'
    }`}
  >
    <View className="flex-row items-center mb-3">
      {icon}
      <Text className="text-lg font-bold text-gray-900 ml-2 flex-1">{title}</Text>
    </View>
    {children}
  </View>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <Text className="text-[15px] text-gray-700 leading-6 mb-2">{children}</Text>
);

const LI = ({ children }: { children: React.ReactNode }) => (
  <View className="flex-row ml-2 mb-1.5">
    <Text className="text-[15px] text-gray-700 mr-1.5">{'\u2022'}</Text>
    <Text className="text-[15px] text-gray-700 flex-1 leading-6">{children}</Text>
  </View>
);

const Bold = ({ children }: { children: React.ReactNode }) => (
  <Text className="font-semibold text-gray-900">{children}</Text>
);

export default function TermsOfServiceContent() {
  return (
    <View>
      <View className="rounded-2xl p-5 mb-4 bg-white border-2 border-gray-300">
        <P>
          Welcome to <Bold>PayByCard</Bold> operated through the website https://paybycard.in (collectively referred to as the "Platform" or "Services").
        </P>
        <P>
          These Terms of Service ("Terms") constitute a legally binding agreement between you ("User", "you", or "your") and <Bold>PayByCard Technologies Private Limited</Bold>, a company incorporated under the Companies Act, 2013, having its registered office at <Bold>3701, IRIS, Runwal Bliss, Crompton Greaves Compound, Kanjurmarg East, Mumbai, Maharashtra 400 042</Bold>.
        </P>
        <P>
          By accessing, browsing, or using the Platform or Services in any manner, you acknowledge that you have read, understood, and unconditionally agree to be bound by these Terms, along with our Privacy Policy, Refund Policy, and Fraud Reporting & Management Policy (collectively referred to as "Policies"). If you do not agree, you must immediately cease all use of the Platform.
        </P>
      </View>

      <Section icon={<CreditCard size={20} color="#8c76f0" />} title="1. About Our Services">
        <P>
          PayByCard is a technology platform that facilitates online payments using debit cards, credit cards, UPI, net banking, and other supported payment instruments for various fees, invoices, and institutional payments.
        </P>
        <P>
          We act solely as a payment facilitator and intermediary. We are not a bank, financial institution, or party to the underlying transaction between the payer (you) and the payee (merchant, school, college, coaching institute, or any other recipient). All funds are processed through RBI-authorized payment gateways and banks.
        </P>
        <P>
          We do not hold customer funds beyond the time required for settlement, nor do we provide any banking or credit services.
        </P>
      </Section>

      <Section icon={<UserCheck size={20} color="#8c76f0" />} title="2. Eligibility" variant="purple">
        <LI>You must be at least 18 years of age and legally competent to enter into contracts under Indian law.</LI>
        <LI>Corporate or institutional users must ensure the authorized representative has the necessary power to bind the entity.</LI>
        <LI>By using the Services, you represent and warrant that you meet the above criteria and will comply with all applicable laws, including those prescribed by the Reserve Bank of India (RBI).</LI>
      </Section>

      <Section title="3. User Account and Security">
        <P>Certain features may require account registration. You are solely responsible for:</P>
        <LI>Maintaining the confidentiality of your login credentials.</LI>
        <LI>All activities conducted under your account.</LI>
        <LI>Immediately notifying us of any unauthorized access.</LI>
        <P>
          We reserve the right to suspend or terminate accounts suspected of misuse, fraud, or violation of these Terms.
        </P>
      </Section>

      <Section title="4. Mandatory KYC and Merchant Onboarding" variant="purple">
        <P>
          As required under applicable laws, regulations, and guidelines, including applicable RBI requirements, PayByCard may be required to verify the identity and KYC details of both the payer/sender and the beneficiary/merchant/recipient before processing a payment.
        </P>
        <P>
          Completion of the required KYC verification is mandatory for users before they can initiate or make payments through the Platform. Similarly, the beneficiary/merchant must complete the applicable onboarding and KYC requirements within the timeline specified by PayByCard or its payment/banking partners.
        </P>
        <P>
          PayByCard reserves the right to decline, hold, suspend, or refund a transaction where the required KYC or merchant onboarding is incomplete, unsuccessful, expired, or not completed within the prescribed timeline. Any refund will be processed in accordance with the applicable refund policy and the procedures of the relevant payment gateway and banking partners.
        </P>
      </Section>

      <Section title="5. Transaction Verification and Cooperation">
        <P>
          For security, fraud prevention, regulatory compliance, and transaction monitoring purposes, PayByCard, its payment gateway partners, banking partners, or other authorized service providers may contact users to verify the authenticity, nature, purpose, or other relevant details of a transaction.
        </P>
        <P>
          Users are required to reasonably cooperate with such verification requests and provide accurate and relevant information or supporting documents when requested. Failure to provide the required information or cooperate with a verification request may result in the transaction being held, declined, cancelled, or refunded, as applicable.
        </P>
      </Section>

      <Section title="6. Protection of Card and Payment Credentials" variant="purple">
        <P>
          PayByCard, its employees, payment gateway partners, and banking partners will not require users to disclose their complete card number, card expiry date, CVV/CVC, PIN, OTP, or other confidential authentication credentials through unsolicited calls, messages, emails, or other communication channels.
        </P>
        <P>
          Users must never share their card number, expiry date, CVV/CVC, PIN, OTP, passwords, or other confidential payment credentials with any person claiming to represent PayByCard or any third party. Users should provide such credentials only through the secure payment interface provided for completing an authorized transaction.
        </P>
        <P>
          If a user receives a suspicious request for confidential payment credentials, the user should not disclose the information and should immediately contact PayByCard through its official support channels.
        </P>
      </Section>

      <Section title="7. Fees and Charges">
        <P>
          All applicable convenience fees, processing charges, GST, and other costs are clearly displayed before you confirm any transaction. By proceeding, you agree to pay these charges.
        </P>
        <P>
          Our fees are non-refundable except in limited cases explicitly mentioned in the Refund Policy. We may revise fees with prior notice on the Platform.
        </P>
      </Section>

      <Section icon={<AlertTriangle size={20} color="#8c76f0" />} title="8. Prohibited Conduct" variant="purple">
        <P>
          You agree not to use the Services for any purpose that is unlawful, fraudulent, or prohibited under these Terms or applicable laws. Prohibited activities include (but are not limited to):
        </P>
        <LI>PayByCard is not a cash withdrawal or credit-card-to-bank-account cash conversion service. Payments are intended only for genuine underlying transactions to verified recipients and are subject to applicable card-network, payment-partner and regulatory requirements.</LI>
        <LI>Making payments for illegal goods, services, or purposes.</LI>
        <LI>Providing false, inaccurate, or misleading information.</LI>
        <LI>Attempting to circumvent security measures, fees, or transaction limits.</LI>
        <LI>Sharing sensitive payment details (card number, CVV, OTP) with unauthorized persons.</LI>
        <LI>Engaging in money laundering, terrorist financing, or any activity violating Prevention of Money Laundering Act (PMLA) or RBI guidelines.</LI>
        <LI>Using automated scripts, bots, or any means to overload or interfere with the Platform.</LI>
        <View className="bg-amber-50 border-l-4 border-amber-500 p-3 mt-3 rounded">
          <Text className="text-sm font-semibold text-amber-900">
            Important Security Advisory: PayByCard or its representatives will never request your CVV, OTP, or full card details over phone, email, SMS, or any unsolicited communication. Any such request is fraudulent — report it immediately.
          </Text>
        </View>
      </Section>

      <Section icon={<Clock size={20} color="#8c76f0" />} title="9. Payment Gateway Holds, Risk Review and Delayed Settlement">
        <P>
          In certain circumstances, the payment gateway, acquiring bank, payment aggregator, or other banking/payment partner may place a temporary hold, reserve, or restriction on the settlement of a transaction or related funds due to risk evaluation, fraud prevention, chargeback/dispute management, regulatory requirements, compliance review, suspected suspicious activity, or any other reason determined by such payment partner.
        </P>
        <P>
          Where a transaction has already been initiated or successfully processed but the settlement of the corresponding funds is subsequently restricted or placed on hold by the relevant payment gateway, acquiring bank, payment aggregator, or other payment partner, PayByCard may be unable to release or settle such funds until the restriction is lifted and the funds are actually received and made available to PayByCard.
        </P>
        <P>
          Accordingly, notwithstanding the standard settlement timelines communicated by PayByCard, settlement of such affected transactions may be delayed for an extended period, including up to 120 days or such longer period as may be required under applicable law, regulatory requirements, or the policies and procedures of the relevant payment partner. PayByCard shall have no liability for delays arising solely from such third-party restrictions, holds, investigations, chargebacks, or regulatory/compliance processes, provided that PayByCard takes reasonable steps to facilitate release and settlement of the funds once the restriction is removed.
        </P>
      </Section>

      <Section title="10. Intellectual Property Rights" variant="purple">
        <P>
          All content, logos, trademarks, designs, software, and technology on the Platform are owned by or licensed to PayByCard. You are granted a limited, revocable, non-exclusive, non-transferable license to access and use the Services for personal or authorized business purposes only.
        </P>
        <P>
          Any unauthorized reproduction, modification, distribution, or reverse engineering is strictly prohibited.
        </P>
      </Section>

      <Section icon={<Shield size={20} color="#8c76f0" />} title="11. Privacy and Data Protection">
        <P>
          We collect, process, and protect your personal and transaction data in accordance with our Privacy Policy and applicable laws, including the Digital Personal Data Protection Act, 2023 (DPDP Act) and the Information Technology Act, 2000.
        </P>
        <P>
          By using the Services, you consent to such collection and processing as described in the Privacy Policy.
        </P>
      </Section>

      <Section title="12. Disclaimers" variant="purple">
        <P>
          The Platform and Services are provided on an "as is" and "as available" basis without any warranties, express or implied.
        </P>
        <P>We do not warrant:</P>
        <LI>Uninterrupted, error-free, or secure operation of the Services.</LI>
        <LI>Success of every transaction (failures may occur due to bank, card issuer, or network issues).</LI>
        <LI>Accuracy or completeness of any information on the Platform.</LI>
        <P>
          We are not liable for any disputes between you and the payee regarding the underlying goods, services, or fees.
        </P>
      </Section>

      <Section title="13. Limitation of Liability">
        <P>
          To the maximum extent permitted by law, PayByCard, its directors, officers, employees, and affiliates shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising from your use of the Services.
        </P>
        <P>
          Our total aggregate liability shall not exceed the total fees paid by you to us in the twelve (12) months immediately preceding the claim.
        </P>
      </Section>

      <Section title="14. Indemnification" variant="purple">
        <P>
          You agree to indemnify, defend, and hold harmless PayByCard and its affiliates from and against any claims, damages, losses, liabilities, costs, and expenses (including reasonable legal fees) arising out of or relating to:
        </P>
        <LI>Your use or misuse of the Services.</LI>
        <LI>Any violation of these Terms or applicable laws.</LI>
        <LI>Any dispute with the payee or third parties.</LI>
      </Section>

      <Section title="15. Termination">
        <P>
          We may suspend or terminate your access to the Services at any time, with or without notice, for breach of these Terms, suspected fraud, or regulatory requirements.
        </P>
        <P>
          Upon termination, all rights granted to you under these Terms cease immediately. Surviving provisions include those relating to disclaimers, limitation of liability, indemnification, and governing law.
        </P>
      </Section>

      <Section title="16. Amendments" variant="purple">
        <P>
          We reserve the right to modify these Terms at any time. We will post the updated Terms on the Platform with a new effective date. Your continued use of the Services after such changes constitutes your acceptance of the revised Terms.
        </P>
      </Section>

      <Section icon={<Gavel size={20} color="#8c76f0" />} title="17. Governing Law and Dispute Resolution">
        <P>These Terms shall be governed by and construed in accordance with the laws of India.</P>
        <P>
          Any disputes arising out of or in connection with these Terms shall be subject to the exclusive jurisdiction of the courts located in Mumbai, Maharashtra.
        </P>
        <P>
          Parties may first attempt amicable resolution. Unresolved disputes shall be referred to arbitration under the Arbitration and Conciliation Act, 1996, by a sole arbitrator appointed by us. The seat of arbitration shall be Mumbai, and proceedings shall be conducted in English.
        </P>
      </Section>

      <Section icon={<Globe size={20} color="#8c76f0" />} title="18. Miscellaneous">
        <P><Bold>Severability:</Bold> If any provision is held invalid or unenforceable, the remaining provisions shall remain in full force.</P>
        <P><Bold>Waiver:</Bold> Failure to enforce any right does not constitute a waiver.</P>
        <P><Bold>Entire Agreement:</Bold> These Terms, together with the referenced Policies, constitute the entire agreement between you and PayByCard.</P>
        <P><Bold>Force Majeure:</Bold> We are not liable for delays or failures due to events beyond our reasonable control.</P>
      </Section>

      <Section icon={<Mail size={20} color="#8c76f0" />} title="Contact Us">
        <P>For any questions regarding these Terms, please contact us at:</P>
        <P><Bold>Email:</Bold> support@paybycard.in</P>
        <P><Bold>Address:</Bold> PayByCard Technologies Pvt. Ltd., 3701, IRIS, Runwal Bliss, Crompton Greaves Compound, Kanjurmarg East, Mumbai, Maharashtra 400 042</P>
        <P><Bold>Phone:</Bold> +91 88501 44143</P>
      </Section>

      <Section icon={<Building size={20} color="#8c76f0" />} title="Acknowledgement" variant="purple">
        <Text className="text-base font-semibold text-gray-900">
          By using PayByCard, you confirm that you have read, understood, and agreed to these Terms of Service.
        </Text>
      </Section>
    </View>
  );
}
