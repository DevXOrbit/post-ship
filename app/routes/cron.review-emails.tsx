/**
 * app/routes/cron.review-emails.tsx
 *
 * Cron endpoint: GET /cron/review-emails
 *
 * Called daily by a Vercel Cron Job (vercel.json):
 *   { "crons": [{ "path": "/cron/review-emails", "schedule": "0 9 * * *" }] }
 *
 * Finds all ReviewSchedule records where:
 *   - sent = false
 *   - sendAfter <= now
 *
 * Sends review request emails via Resend, marks records as sent.
 *
 * Security: validates CRON_SECRET header to prevent unauthorized calls.
 */
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { getSettings } from "../lib/settings.server";
import { sendReviewEmail } from "../lib/email.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  // ── Auth: Vercel Cron Secret ───────────────────────────────────────────
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const now = new Date();

  // Fetch all due, unsent review schedules (batch max 100 per run)
  const due = await prisma.reviewSchedule.findMany({
    where: { sent: false, sendAfter: { lte: now } },
    take: 100,
    orderBy: { sendAfter: "asc" },
  });

  if (due.length === 0) {
    return new Response(JSON.stringify({ processed: 0 }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  console.log(`[PostShip Cron] Processing ${due.length} review email(s).`);

  let sent = 0;
  let failed = 0;

  for (const schedule of due) {
    const settings = await getSettings(schedule.shop);

    // Re-check plan and feature flag at send time (merchant may have downgraded)
    if (!settings.enableReviewEmails || settings.plan === "free") {
      // Mark as sent so we don't retry — plan changed
      await prisma.reviewSchedule.update({
        where: { id: schedule.id },
        data: { sent: true, sentAt: new Date() },
      });
      continue;
    }

    if (!settings.resendApiKey || !settings.fromEmail) {
      console.warn(`[PostShip Cron] Resend not configured for ${schedule.shop} — skipping.`);
      failed++;
      continue;
    }

    // Dedup via EmailLog
    try {
      await prisma.emailLog.create({
        data: {
          shop: schedule.shop,
          orderId: schedule.orderId,
          type: "review_request",
        },
      });
    } catch {
      // Already sent — mark schedule as done
      await prisma.reviewSchedule.update({
        where: { id: schedule.id },
        data: { sent: true, sentAt: new Date() },
      });
      continue;
    }

    // Build the review URL — links to the shop's product reviews page
    const reviewUrl = `https://${schedule.shop}/pages/reviews?order=${encodeURIComponent(schedule.orderName.replace("#", ""))}`;

    const result = await sendReviewEmail({
      to: schedule.customerEmail,
      orderName: schedule.orderName,
      customerName: schedule.customerName,
      shopName: settings.senderName || schedule.shop,
      shopDomain: schedule.shop,
      brandColor: settings.brandColor,
      fromEmail: settings.fromEmail,
      senderName: settings.senderName || schedule.shop,
      resendApiKey: settings.resendApiKey,
      enableCoupon: settings.enableCoupon,
      couponCode: settings.couponCode,
      couponDiscountPercent: settings.couponDiscountPercent,
      couponExpiryDays: settings.couponExpiryDays,
      reviewUrl,
    });

    if (result.success) {
      await prisma.reviewSchedule.update({
        where: { id: schedule.id },
        data: { sent: true, sentAt: new Date() },
      });
      console.log(`[PostShip Cron] Review email sent → ${schedule.customerEmail} (${schedule.orderName})`);
      sent++;
    } else {
      console.error(`[PostShip Cron] Review email FAILED for ${schedule.orderName}: ${result.error}`);
      failed++;
      // Don't mark as sent — will retry next cron run
    }
  }

  return new Response(
    JSON.stringify({ processed: due.length, sent, failed }),
    { headers: { "Content-Type": "application/json" } }
  );
};
