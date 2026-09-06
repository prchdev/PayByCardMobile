export interface EmailTemplateOptions {
  title: string;
  content: string;
  buttonText?: string;
  buttonLink?: string;
  showFooter?: boolean;
}

export function createEmailTemplate(options: EmailTemplateOptions): string {
  const {
    title,
    content,
    buttonText,
    buttonLink,
    showFooter = true,
  } = options;

  const websiteUrl = 'https://paybycard.in';
  const supportEmail = 'support@paybycard.in';
  const supportPhone = '+91 88501 44143';
  const logoUrl = `${websiteUrl}/PayByCard-Logo.png`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      background-color: #f9fafb;
      color: #374151;
    }
    .email-wrapper {
      width: 100%;
      background-color: #f9fafb;
      padding: 40px 20px;
    }
    .email-container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 16px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
      overflow: hidden;
    }
    .email-header {
      background: linear-gradient(135deg, #8c76f0 0%, #a78bfa 100%);
      padding: 40px 30px;
      text-align: center;
      position: relative;
    }
    .email-header::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: url('data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 120"><path d="M0,50 Q300,100 600,50 T1200,50 L1200,0 L0,0 Z" fill="rgba(255,255,255,0.1)"/></svg>') no-repeat center bottom;
      background-size: cover;
    }
    .logo-container {
      background-color: #ffffff;
      display: inline-block;
      padding: 12px 24px;
      border-radius: 12px;
      margin-bottom: 16px;
      box-shadow: 0 4px 12px rgba(140, 118, 240, 0.3);
      position: relative;
    }
    .logo {
      height: 40px;
      display: block;
    }
    .email-title {
      color: #ffffff;
      font-size: 28px;
      font-weight: 700;
      margin: 0;
      position: relative;
    }
    .email-body {
      padding: 40px 30px;
    }
    .email-content {
      color: #4b5563;
      font-size: 16px;
      line-height: 1.6;
      margin-bottom: 30px;
    }
    .button-container {
      text-align: center;
      margin: 30px 0;
    }
    .email-button {
      display: inline-block;
      background: linear-gradient(135deg, #8c76f0 0%, #a78bfa 100%);
      color: #ffffff;
      text-decoration: none;
      padding: 14px 32px;
      border-radius: 50px;
      font-weight: 600;
      font-size: 16px;
      box-shadow: 0 4px 12px rgba(140, 118, 240, 0.4);
      transition: all 0.3s ease;
    }
    .email-button:hover {
      box-shadow: 0 6px 16px rgba(140, 118, 240, 0.5);
      transform: translateY(-2px);
    }
    .divider {
      height: 1px;
      background: linear-gradient(90deg, transparent, #e5e7eb, transparent);
      margin: 30px 0;
    }
    .email-footer {
      background-color: #f9fafb;
      padding: 30px;
      border-top: 2px solid #e5e7eb;
    }
    .footer-content {
      text-align: center;
      color: #6b7280;
      font-size: 14px;
      line-height: 1.6;
    }
    .footer-links {
      margin: 20px 0;
      display: flex;
      justify-content: center;
      gap: 24px;
      flex-wrap: wrap;
    }
    .footer-link {
      color: #8c76f0;
      text-decoration: none;
      font-weight: 500;
      transition: color 0.3s ease;
    }
    .footer-link:hover {
      color: #7c3aed;
    }
    .contact-info {
      margin: 20px 0;
      padding: 16px;
      background-color: #ffffff;
      border-radius: 8px;
      border: 1px solid #e5e7eb;
    }
    .contact-item {
      display: flex;
      align-items: center;
      justify-content: center;
      margin: 8px 0;
      color: #4b5563;
      font-size: 14px;
    }
    .contact-icon {
      color: #8c76f0;
      margin-right: 8px;
      font-weight: 600;
    }
    .company-info {
      margin-top: 20px;
      padding-top: 20px;
      border-top: 1px solid #e5e7eb;
      font-size: 12px;
      color: #9ca3af;
    }
    .security-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%);
      color: #16a34a;
      padding: 8px 16px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 600;
      margin: 16px auto 0;
    }
    @media only screen and (max-width: 600px) {
      .email-wrapper {
        padding: 20px 10px;
      }
      .email-header {
        padding: 30px 20px;
      }
      .email-title {
        font-size: 24px;
      }
      .email-body {
        padding: 30px 20px;
      }
      .footer-links {
        flex-direction: column;
        gap: 12px;
      }
    }
  </style>
</head>
<body>
  <div class="email-wrapper">
    <div class="email-container">
      <div class="email-header">
        <div class="logo-container">
          <img src="${logoUrl}" alt="PayByCard" class="logo" />
        </div>
        <h1 class="email-title">${title}</h1>
      </div>

      <div class="email-body">
        <div class="email-content">
          ${content}
        </div>

        ${buttonText && buttonLink ? `
        <div class="button-container">
          <a href="${buttonLink}" class="email-button">${buttonText}</a>
        </div>
        ` : ''}

        ${showFooter ? `
        <div class="divider"></div>

        <div class="security-badge">
          🔒 Secure & Encrypted Communication
        </div>
        ` : ''}
      </div>

      ${showFooter ? `
      <div class="email-footer">
        <div class="footer-content">
          <div class="contact-info">
            <div class="contact-item">
              <span class="contact-icon">📧</span>
              <a href="mailto:${supportEmail}" style="color: #8c76f0; text-decoration: none;">${supportEmail}</a>
            </div>
            <div class="contact-item">
              <span class="contact-icon">📞</span>
              <span>${supportPhone}</span>
            </div>
            <div class="contact-item">
              <span class="contact-icon">🌐</span>
              <a href="${websiteUrl}" style="color: #8c76f0; text-decoration: none;">${websiteUrl}</a>
            </div>
          </div>

          <div class="footer-links">
            <a href="${websiteUrl}/about" class="footer-link">About Us</a>
            <a href="${websiteUrl}/terms" class="footer-link">Terms of Service</a>
            <a href="${websiteUrl}/privacy" class="footer-link">Privacy Policy</a>
            <a href="${websiteUrl}/contact" class="footer-link">Contact Us</a>
          </div>

          <div class="company-info">
            <p style="margin: 0 0 8px 0;"><strong>PayByCard Technologies Pvt. Ltd.</strong></p>
            <p style="margin: 0 0 8px 0;">
              3701, IRIS, Runwal Bliss, Crompton Greaves Compound, Kanjurmarg East<br />
              Mumbai, Maharashtra 400 042
            </p>
            <p style="margin: 8px 0 0 0;">CIN: U62099MH2025PTC462923</p>
            <p style="margin: 12px 0 0 0;">© ${new Date().getFullYear()} PayByCard Technologies Pvt. Ltd. All rights reserved.</p>
          </div>
        </div>
      </div>
      ` : ''}
    </div>
  </div>
</body>
</html>
  `.trim();
}

// redeploy
