/**
 * app/lib/email.server.ts
 *
 * Resend email client + branded HTML template builder for PostShip.
 *
 * Templates:
 *   buildTrackingEmail()  — sent when order is shipped
 *   buildDeliveredEmail() — sent when order is delivered
 *   buildReviewEmail()    — sent X days after delivered (with optional coupon)
 *
 * All templates are fully self-contained HTML (no external CSS framework)
 * so they render well across Gmail, Outlook, Apple Mail, and mobile clients.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface SendResult {
  success: boolean;
  id?: string;
  error?: string;
}

export interface TrackingEmailData {
  to: string;
  orderName: string; // "#1001"
  customerName: string; // from shipping address
  trackingNumber: string;
  trackingUrl: string;
  carrier: string;
  shopName: string;
  shopDomain: string; // "mystore.myshopify.com" — for deep-link
  brandColor: string; // hex
  fromEmail: string;
  senderName: string;
  resendApiKey: string;
}

export interface DeliveredEmailData extends Omit<
  TrackingEmailData,
  "trackingNumber" | "trackingUrl" | "carrier"
> {
  // Delivered emails don't need tracking details
}

export interface ReviewEmailData {
  to: string;
  orderName: string;
  customerName: string;
  shopName: string;
  shopDomain: string;
  brandColor: string;
  fromEmail: string;
  senderName: string;
  resendApiKey: string;
  enableCoupon: boolean;
  couponCode: string;
  couponDiscountPercent: number;
  couponExpiryDays: number;
  reviewUrl: string; // deep-link to product review section
}

// ── Resend send helper ─────────────────────────────────────────────────────

async function sendViaResend(
  apiKey: string,
  payload: {
    from: string;
    to: string;
    subject: string;
    html: string;
  },
): Promise<SendResult> {
  if (!apiKey) {
    console.warn("[PostShip] No Resend API key configured — email skipped.");
    return { success: false, error: "No Resend API key configured." };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const data = (await res.json()) as {
      id?: string;
      message?: string;
      name?: string;
    };

    if (!res.ok) {
      const errMsg = data.message ?? data.name ?? `Resend error ${res.status}`;
      console.error("[PostShip] Resend error:", errMsg);
      return { success: false, error: errMsg };
    }

    return { success: true, id: data.id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[PostShip] Resend fetch failed:", msg);
    return { success: false, error: msg };
  }
}

// ── Template helpers ───────────────────────────────────────────────────────

function trackingPageUrl(
  shopDomain: string,
  orderName: string,
  email: string,
): string {
  const name = orderName.replace("#", "");
  return `https://${shopDomain}/apps/postship?order=${encodeURIComponent(name)}&email=${encodeURIComponent(email)}&auto=1`;
}

function baseTemplate(
  brandColor: string,
  shopName: string,
  preheader: string,
  body: string,
): string {
  // Subtle lighter version of the brand color for backgrounds
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${shopName}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <!-- Preheader (hidden preview text) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">
    ${preheader}&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌&nbsp;‌
  </div>

  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,0.08);">

          <!-- Header bar -->
          <tr>
            <td style="background:${brandColor};padding:24px 32px;">
              <p style="margin:0;color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">${shopName}</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:32px 32px 24px;">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:16px 32px 28px;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-size:12px;color:#9ca3af;line-height:1.6;">
                You received this email because you placed an order with ${shopName}.<br>
                Powered by <a href="https://postship.app" style="color:#9ca3af;">PostShip</a>.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function primaryButton(href: string, label: string, color: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:24px 0 0;">
    <tr>
      <td style="background:${color};border-radius:6px;">
        <a href="${href}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:-0.1px;">${label}</a>
      </td>
    </tr>
  </table>`;
}

function infoRow(label: string, value: string): string {
  return `<tr>
    <td style="padding:6px 0;font-size:13px;color:#6b7280;width:140px;vertical-align:top;">${label}</td>
    <td style="padding:6px 0;font-size:13px;color:#111827;font-weight:500;vertical-align:top;">${value}</td>
  </tr>`;
}

// ── Public send functions ──────────────────────────────────────────────────

/**
 * Send a "your order has shipped" email.
 */

export async function sendTrackingEmail(
  data: TrackingEmailData,
): Promise<SendResult> {
  const trackUrl =
    data.trackingUrl ||
    `https://www.google.com/search?q=${encodeURIComponent(data.carrier + " " + data.trackingNumber)}`;
  const deepLink = trackingPageUrl(data.shopDomain, data.orderName, data.to);

  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Your order is on its way! 🚚</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
      Hi ${data.customerName || "there"}, great news — your order <strong style="color:#111827;">${data.orderName}</strong> has been shipped and is heading your way.
    </p>

    <table cellpadding="0" cellspacing="0" border="0" style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:16px 20px;margin-bottom:0;width:100%;">
      <tbody>
        ${infoRow("Order", data.orderName)}
        ${infoRow("Carrier", data.carrier || "See tracking link")}
        ${infoRow("Tracking #", `<a href="${trackUrl}" style="color:${data.brandColor};text-decoration:none;">${data.trackingNumber}</a>`)}
      </tbody>
    </table>

    ${primaryButton(deepLink, "Track Your Order →", data.brandColor)}

    <p style="margin:20px 0 0;font-size:13px;color:#9ca3af;line-height:1.6;">
      Or paste this link in your browser:<br>
      <a href="${deepLink}" style="color:${data.brandColor};word-break:break-all;">${deepLink}</a>
    </p>
  `;

  return sendViaResend(data.resendApiKey, {
    from: `${data.senderName} <${data.fromEmail}>`,
    to: data.to,
    subject: `Your order ${data.orderName} has shipped 📦`,
    html: baseTemplate(
      data.brandColor,
      data.shopName,
      `Your order ${data.orderName} has shipped and is on its way.`,
      body,
    ),
  });
}

/**
 * Send a "your order has been delivered" email.
 */
export async function sendDeliveredEmail(
  data: DeliveredEmailData,
): Promise<SendResult> {
  const deepLink = trackingPageUrl(data.shopDomain, data.orderName, data.to);

  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">Your order has been delivered! 🎉</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
      Hi ${data.customerName || "there"}, your order <strong style="color:#111827;">${data.orderName}</strong> has been delivered. We hope you love it!
    </p>
    <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
      If you have any questions or need help with your order, you can view your order details or request support below.
    </p>
    ${primaryButton(deepLink, "View Order Details →", data.brandColor)}
  `;

  return sendViaResend(data.resendApiKey, {
    from: `${data.senderName} <${data.fromEmail}>`,
    to: data.to,
    subject: `Your order ${data.orderName} has been delivered ✅`,
    html: baseTemplate(
      data.brandColor,
      data.shopName,
      `Your order ${data.orderName} has been delivered.`,
      body,
    ),
  });
}

/**
 * Send a post-delivery review request (with optional coupon).
 */
export async function sendReviewEmail(
  data: ReviewEmailData,
): Promise<SendResult> {
  const couponBlock =
    data.enableCoupon && data.couponCode
      ? `
    <table cellpadding="0" cellspacing="0" border="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px 20px;margin:24px 0 0;width:100%;">
      <tr>
        <td>
          <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#166534;">🎁 Thank you gift</p>
          <p style="margin:0 0 10px;font-size:14px;color:#15803d;line-height:1.5;">
            Here's <strong>${data.couponDiscountPercent}% off</strong> your next order as a thank you. Valid for ${data.couponExpiryDays} days.
          </p>
          <p style="margin:0;font-size:20px;font-weight:700;color:#166534;letter-spacing:2px;">${data.couponCode}</p>
        </td>
      </tr>
    </table>`
      : "";

  const body = `
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:#111827;">How was your order? ⭐</h1>
    <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.6;">
      Hi ${data.customerName || "there"}, we hope you're enjoying your order <strong style="color:#111827;">${data.orderName}</strong>.
      We'd love to hear what you think — your feedback helps us improve and helps other shoppers too.
    </p>
    ${primaryButton(data.reviewUrl, "Leave a Review →", data.brandColor)}
    ${couponBlock}
  `;

  return sendViaResend(data.resendApiKey, {
    from: `${data.senderName} <${data.fromEmail}>`,
    to: data.to,
    subject: `How was your order from ${data.shopName}? We'd love your feedback ⭐`,
    html: baseTemplate(
      data.brandColor,
      data.shopName,
      `How was your order from ${data.shopName}? Share your feedback.`,
      body,
    ),
  });
}
