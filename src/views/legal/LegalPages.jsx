import { useNavigate, useLocation } from "react-router-dom";

const S = {
  page: { minHeight: "100vh", background: "#fafafa", color: "#1a1a1a", fontFamily: "system-ui, -apple-system, sans-serif", padding: "40px 20px" },
  container: { maxWidth: 720, margin: "0 auto" },
  back: { background: "none", border: "none", color: "#666", cursor: "pointer", fontSize: 14, padding: 0, marginBottom: 24, fontFamily: "inherit" },
  h1: { fontSize: 28, fontWeight: 700, marginBottom: 8, color: "#111" },
  updated: { fontSize: 13, color: "#888", marginBottom: 32 },
  h2: { fontSize: 18, fontWeight: 700, marginTop: 32, marginBottom: 12, color: "#222" },
  p: { fontSize: 15, lineHeight: 1.7, color: "#444", marginBottom: 16 },
  ul: { paddingLeft: 24, marginBottom: 16 },
  li: { fontSize: 15, lineHeight: 1.7, color: "#444", marginBottom: 6 },
};

const BUSINESS = "Champ's Butcher Shop";
const CONTACT_EMAIL = "frank@andaleconstruction.com";
const ADDRESS = "135 Main Street, Halstead, KS 67056";
const EFFECTIVE_DATE = "April 3, 2026";

export function PrivacyPolicy() {
  const navigate = useNavigate();
  return (
    <div style={S.page}><div style={S.container}>
      <button onClick={() => navigate(-1)} style={S.back}>&larr; Back</button>
      <h1 style={S.h1}>Privacy Policy</h1>
      <div style={S.updated}>Effective Date: {EFFECTIVE_DATE}</div>

      <p style={S.p}>{BUSINESS} ("we," "us," or "our") operates a kiosk ordering system and related services. This Privacy Policy describes how we collect, use, store, and protect your personal information when you use our kiosk, website, or related services.</p>

      <h2 style={S.h2}>1. Information We Collect</h2>
      <p style={S.p}>We collect the following information when you create an account or place an order:</p>
      <ul style={S.ul}>
        <li style={S.li}><strong>Account information:</strong> First name, last name, email address, phone number, and delivery location preference.</li>
        <li style={S.li}><strong>Order information:</strong> Items ordered, quantities, order totals, order history, and order status.</li>
        <li style={S.li}><strong>Authentication data:</strong> A hashed version of your password (we never store your actual password).</li>
      </ul>

      <h2 style={S.h2}>2. How We Use Your Information</h2>
      <p style={S.p}>We use your information to:</p>
      <ul style={S.ul}>
        <li style={S.li}>Process and fulfill your kiosk orders.</li>
        <li style={S.li}>Create and manage your customer account.</li>
        <li style={S.li}>Send order confirmations and invoices via our integrated accounting system (QuickBooks Online).</li>
        <li style={S.li}>Track inventory and manage our product catalog.</li>
        <li style={S.li}>Improve our services and customer experience.</li>
      </ul>

      <h2 style={S.h2}>3. QuickBooks Online Integration</h2>
      <p style={S.p}>We use QuickBooks Online by Intuit to manage invoicing, inventory, and customer records. When you place an order:</p>
      <ul style={S.ul}>
        <li style={S.li}>Your name, email address, and phone number may be shared with QuickBooks Online to create a customer record and generate an invoice.</li>
        <li style={S.li}>Your order details (items, quantities, totals) are sent to QuickBooks Online for invoicing and inventory tracking.</li>
        <li style={S.li}>We access QuickBooks Online data (product catalog, inventory levels, customer records) to operate our kiosk system.</li>
      </ul>
      <p style={S.p}>QuickBooks Online data is accessed through secure, encrypted connections using OAuth 2.0 authentication. Access tokens are encrypted at rest using AES-256-GCM encryption. We do not store any payment card information — all payment processing is handled directly by QuickBooks.</p>

      <h2 style={S.h2}>4. Data Storage and Security</h2>
      <p style={S.p}>Your data is stored securely using the following measures:</p>
      <ul style={S.ul}>
        <li style={S.li}><strong>Database:</strong> Google Cloud Firestore with encryption at rest and in transit.</li>
        <li style={S.li}><strong>Authentication tokens:</strong> QuickBooks OAuth tokens are encrypted with AES-256-GCM before storage.</li>
        <li style={S.li}><strong>Passwords:</strong> Stored as one-way hashes, never in plain text.</li>
        <li style={S.li}><strong>HTTPS:</strong> All data transmitted between your device and our servers is encrypted using TLS/HTTPS.</li>
        <li style={S.li}><strong>Access controls:</strong> Administrative access is restricted to authorized staff with role-based permissions.</li>
      </ul>

      <h2 style={S.h2}>5. Data Sharing</h2>
      <p style={S.p}>We do not sell, rent, or trade your personal information to third parties. We share your data only with:</p>
      <ul style={S.ul}>
        <li style={S.li}><strong>QuickBooks Online (Intuit):</strong> For invoicing, inventory management, and customer records as described above.</li>
        <li style={S.li}><strong>Google Cloud Platform:</strong> Our hosting and database provider, which processes data on our behalf under strict data protection agreements.</li>
      </ul>

      <h2 style={S.h2}>6. Data Retention</h2>
      <p style={S.p}>We retain your account information and order history for as long as your account is active or as needed to provide our services. You may request deletion of your account and associated data at any time by contacting us.</p>

      <h2 style={S.h2}>7. Your Rights</h2>
      <p style={S.p}>You have the right to:</p>
      <ul style={S.ul}>
        <li style={S.li}>Access the personal information we hold about you.</li>
        <li style={S.li}>Request correction of inaccurate information.</li>
        <li style={S.li}>Request deletion of your account and personal data.</li>
        <li style={S.li}>Request that we disconnect your data from QuickBooks Online.</li>
      </ul>

      <h2 style={S.h2}>8. Children's Privacy</h2>
      <p style={S.p}>Our services are not directed at children under 13. We do not knowingly collect personal information from children under 13.</p>

      <h2 style={S.h2}>9. Changes to This Policy</h2>
      <p style={S.p}>We may update this Privacy Policy from time to time. The effective date at the top of this page indicates when it was last revised. Continued use of our services after changes constitutes acceptance of the updated policy.</p>

      <h2 style={S.h2}>10. Contact Us</h2>
      <p style={S.p}>If you have questions about this Privacy Policy or wish to exercise your data rights, contact us at:</p>
      <p style={S.p}>
        {BUSINESS}<br />
        {ADDRESS}<br />
        Email: <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "#2563eb" }}>{CONTACT_EMAIL}</a>
      </p>
    </div></div>
  );
}

export function TermsOfService() {
  const navigate = useNavigate();
  return (
    <div style={S.page}><div style={S.container}>
      <button onClick={() => navigate(-1)} style={S.back}>&larr; Back</button>
      <h1 style={S.h1}>Terms of Service</h1>
      <div style={S.updated}>Effective Date: {EFFECTIVE_DATE}</div>

      <p style={S.p}>These Terms of Service ("Terms") govern your use of the {BUSINESS} kiosk ordering system and related services ("Service"). By using the Service, you agree to these Terms.</p>

      <h2 style={S.h2}>1. Service Description</h2>
      <p style={S.p}>The Service is a kiosk-based ordering system that allows customers to browse products, place orders, and manage their accounts at {BUSINESS}. The Service integrates with QuickBooks Online for order management, invoicing, and inventory tracking.</p>

      <h2 style={S.h2}>2. Account Registration</h2>
      <p style={S.p}>To place orders, you must create an account with accurate and complete information. You are responsible for maintaining the confidentiality of your account credentials and for all activity that occurs under your account.</p>

      <h2 style={S.h2}>3. Orders and Pricing</h2>
      <ul style={S.ul}>
        <li style={S.li}>All prices displayed on the kiosk are in US Dollars and are subject to change.</li>
        <li style={S.li}>Prices are sourced from our QuickBooks Online catalog and may be updated periodically.</li>
        <li style={S.li}>Product availability is based on current inventory levels and is subject to change without notice.</li>
        <li style={S.li}>An invoice will be generated in QuickBooks Online for each order placed.</li>
      </ul>

      <h2 style={S.h2}>4. Payment</h2>
      <p style={S.p}>Payment terms are as specified on your invoice. Payment processing is handled through QuickBooks Online. We do not store credit card or payment information in our kiosk system.</p>

      <h2 style={S.h2}>5. Cancellations and Refunds</h2>
      <p style={S.p}>Order cancellations and refund requests should be made directly with {BUSINESS} staff. Refunds, if applicable, will be processed through QuickBooks Online.</p>

      <h2 style={S.h2}>6. Acceptable Use</h2>
      <p style={S.p}>You agree not to:</p>
      <ul style={S.ul}>
        <li style={S.li}>Use the Service for any unlawful purpose.</li>
        <li style={S.li}>Attempt to gain unauthorized access to the Service or its systems.</li>
        <li style={S.li}>Interfere with or disrupt the operation of the Service.</li>
        <li style={S.li}>Create multiple accounts or provide false information.</li>
      </ul>

      <h2 style={S.h2}>7. Limitation of Liability</h2>
      <p style={S.p}>{BUSINESS} provides the Service "as is" without warranties of any kind. To the maximum extent permitted by law, {BUSINESS} shall not be liable for any indirect, incidental, or consequential damages arising from your use of the Service.</p>

      <h2 style={S.h2}>8. Privacy</h2>
      <p style={S.p}>Your use of the Service is also governed by our <a href="/privacy" style={{ color: "#2563eb" }}>Privacy Policy</a>, which describes how we collect, use, and protect your information.</p>

      <h2 style={S.h2}>9. Changes to Terms</h2>
      <p style={S.p}>We may update these Terms from time to time. The effective date at the top indicates when they were last revised. Continued use of the Service constitutes acceptance of the updated Terms.</p>

      <h2 style={S.h2}>10. Governing Law</h2>
      <p style={S.p}>These Terms are governed by the laws of the State of Kansas, without regard to its conflict of laws principles.</p>

      <h2 style={S.h2}>11. Contact Us</h2>
      <p style={S.p}>
        {BUSINESS}<br />
        {ADDRESS}<br />
        Email: <a href={`mailto:${CONTACT_EMAIL}`} style={{ color: "#2563eb" }}>{CONTACT_EMAIL}</a>
      </p>
    </div></div>
  );
}
