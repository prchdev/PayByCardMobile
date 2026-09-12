import { View, Text } from 'react-native';
import { Eye, Lock, Shield, Cookie, Mail, AlertTriangle } from 'lucide-react-native';

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
      <Text className="text-[31px] font-bold text-gray-900 ml-2 flex-1">{title}</Text>
    </View>
    {children}
  </View>
);

const P = ({ children }: { children: React.ReactNode }) => (
  <Text className="text-[24px] text-gray-700 leading-[34px] mb-3">{children}</Text>
);

const LI = ({ children }: { children: React.ReactNode }) => (
  <View className="flex-row ml-2 mb-2">
    <Text className="text-[24px] text-gray-700 mr-1.5">{'\u2022'}</Text>
    <Text className="text-[24px] text-gray-700 flex-1 leading-[34px]">{children}</Text>
  </View>
);

const Bold = ({ children }: { children: React.ReactNode }) => (
  <Text className="font-semibold text-gray-900">{children}</Text>
);

export default function PrivacyPolicyContent() {
  return (
    <View>
      <View className="rounded-2xl p-5 mb-4 bg-white border-2 border-gray-300">
        <View className="flex-row items-center mb-3">
          <Eye size={20} color="#8c76f0" />
          <Text className="text-[31px] font-bold text-gray-900 ml-2">Introduction</Text>
        </View>
        <P>
          PayByCard Private Limited ("PayByCard", "we", "us", or "our") is committed to protecting your privacy. This Privacy Policy explains how we collect, use, disclose, store, and protect your personal data when you access or use the website https://paybycard.in and the payment facilitation services provided therein (collectively, the "Platform" or "Services").
        </P>
        <P>
          By using the Platform, you consent to the practices described in this Privacy Policy. If you do not agree, please do not use the Services.
        </P>
        <Text className="text-[24px] font-semibold text-gray-900 leading-[34px]">
          This Policy is governed by the Digital Personal Data Protection Act, 2023 (DPDP Act), the Information Technology Act, 2000, and other applicable Indian laws.
        </Text>
      </View>

      <Section title="1. Information We Collect">
        <P>We collect the following categories of information:</P>
        <Text className="text-[24px] font-semibold text-gray-900 mb-2 mt-1">A. Information Provided by You</Text>
        <LI><Bold>Contact details:</Bold> Name, email address, phone number, and mailing address</LI>
        <LI><Bold>Payment-related information:</Bold> Invoice or fee details, transaction amount, and payment references</LI>
        <LI><Bold>Account information</Bold> (if you create an account): Login credentials and preferences</LI>
        <LI>Any other information you voluntarily submit through forms, support requests, or communications</LI>
        <Text className="text-[24px] font-semibold text-gray-900 mb-2 mt-2">B. Automatically Collected Information</Text>
        <LI><Bold>Device and usage data:</Bold> IP address, browser type, operating system, device identifiers, and pages visited</LI>
        <LI><Bold>Transaction metadata:</Bold> Date, time, and status of payments</LI>
        <LI>Cookies and similar technologies for session management, analytics, and improving user experience</LI>
        <Text className="text-[24px] font-semibold text-gray-900 mb-2 mt-2">C. Payment Card Information</Text>
        <P>
          We do not store your complete credit/debit card details, CVV, or sensitive authentication data on our servers. All card transactions are processed securely through RBI-authorized payment gateways and banks that are compliant with Payment Card Industry Data Security Standard (PCI-DSS). Card data is tokenized or encrypted during transmission.
        </P>
      </Section>

      <Section title="2. Purpose of Collection and Processing" variant="purple">
        <P>We collect and process your personal data only for the following legitimate purposes:</P>
        <LI>To facilitate and process online payments for fees, invoices, or institutional transactions</LI>
        <LI>To provide transaction confirmations, digital receipts, and customer support</LI>
        <LI>To verify your identity and prevent fraudulent or unauthorized transactions</LI>
        <LI>To improve the Platform, analyze usage trends, and enhance security</LI>
        <LI>To comply with legal and regulatory obligations, including RBI guidelines, anti-money laundering laws, and tax requirements</LI>
        <LI>To communicate important updates, security alerts, or service-related notices</LI>
        <Text className="text-[24px] font-semibold text-gray-900 mt-2">
          We do not process your data for any purpose incompatible with the above.
        </Text>
      </Section>

      <Section title="3. Data Sharing and Disclosure">
        <P>We may share your personal data only in the following limited circumstances:</P>
        <LI>With RBI-authorized payment gateways, banks, and card networks solely to complete the payment transaction</LI>
        <LI>With service providers (data processors) who assist us in operating the Platform (e.g., hosting, analytics, fraud detection), under strict confidentiality and data processing agreements</LI>
        <LI>When required by law, court order, or government/regulatory authorities (including RBI, cybercrime cells, or law enforcement)</LI>
        <LI>In the event of a merger, acquisition, or restructuring of our business (with appropriate safeguards)</LI>
        <Text className="text-[24px] font-semibold text-gray-900 mt-2">
          We do not sell, rent, or trade your personal data to any third party for marketing purposes.
        </Text>
      </Section>

      <Section icon={<Lock size={20} color="#8c76f0" />} title="4. Data Security" variant="purple">
        <P>We implement reasonable and appropriate technical and organizational security measures to protect your personal data, including:</P>
        <LI>Encryption of data in transit (HTTPS/TLS)</LI>
        <LI>Access controls and authentication mechanisms</LI>
        <LI>Regular security audits and monitoring</LI>
        <LI>Tokenization for payment flows</LI>
        <Text className="text-[24px] font-semibold text-gray-900 mt-2">
          While we strive to protect your information, no system is completely secure. In the unlikely event of a data breach that is likely to result in risk to your rights, we will notify you and the relevant authorities as required under the DPDP Act.
        </Text>
      </Section>

      <Section title="5. Data Retention">
        <P>
          We retain your personal data only as long as necessary to fulfill the purposes for which it was collected or as required by applicable laws (including for audit, legal, or regulatory compliance). Transaction records are typically retained for a minimum of 5-7 years or as mandated by RBI and tax authorities.
        </P>
      </Section>

      <Section icon={<Shield size={20} color="#8c76f0" />} title="6. Your Rights under the DPDP Act" variant="purple">
        <P>As a Data Principal, you have the following rights regarding your personal data:</P>
        <LI>Right to access and obtain a summary of your data</LI>
        <LI>Right to correction or erasure of inaccurate or unnecessary data</LI>
        <LI>Right to nomination (to appoint another person to exercise rights in case of your death or incapacity)</LI>
        <LI>Right to withdraw consent (where processing is based on consent)</LI>
        <LI>Right to grievance redressal</LI>
        <P>
          To exercise any of these rights, please write to us at support@paybycard.in with sufficient details for verification. We will respond within the timelines prescribed under applicable law.
        </P>
      </Section>

      <Section icon={<Cookie size={20} color="#8c76f0" />} title="7. Cookies and Tracking Technologies">
        <P>
          We use essential cookies to enable core functionality (e.g., session management and secure checkout). You may manage cookie preferences through your browser settings. Disabling certain cookies may affect your experience on the Platform.
        </P>
      </Section>

      <Section title="8. Third-Party Links" variant="purple">
        <P>
          The Platform may contain links to third-party websites (including payee institutions). We are not responsible for the privacy practices or content of such external sites. We encourage you to review their privacy policies before providing any information.
        </P>
      </Section>

      <Section title="9. Children's Privacy">
        <P>
          Our Services are not directed at individuals under 18 years of age. We do not knowingly collect personal data from children. If we become aware that we have collected data from a child without verifiable parental consent, we will take steps to delete it.
        </P>
      </Section>

      <Section icon={<AlertTriangle size={20} color="#8c76f0" />} title="10. Changes to This Privacy Policy" variant="purple">
        <P>
          We may update this Privacy Policy from time to time to reflect changes in our practices or legal requirements. The updated Policy will be posted on the Platform with a new effective date. Your continued use of the Services after such changes constitutes your acceptance of the revised Policy.
        </P>
      </Section>

      <Section icon={<Mail size={20} color="#8c76f0" />} title="11. Contact Us / Grievance Officer">
        <P>For any questions, concerns, or to exercise your data rights, please contact us at:</P>
        <Text className="text-[27px] font-semibold text-[#8c76f0]">Email: support@paybycard.in</Text>
        <P>
          We will address your grievance within 30 days or as required by law.
        </P>
      </Section>

      <View className="rounded-2xl p-5 mb-4 bg-purple-50 border-2 border-[#8c76f0]/30">
        <Text className="text-[27px] font-semibold text-gray-900 text-center">
          By using PayByCard, you acknowledge that you have read, understood, and agreed to this Privacy Policy.
        </Text>
      </View>
    </View>
  );
}
