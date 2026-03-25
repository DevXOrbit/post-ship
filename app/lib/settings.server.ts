/**
 * app/lib/settings.server.ts
 *
 * Shared helper for reading and writing AppSettings.
 * Import this in routes and webhooks — never query AppSettings directly.
 *
 * Usage:
 *   const settings = await getSettings(shop);
 *   await upsertSettings(shop, { brandColor: "#ff0000" });
 */
import prisma from "../db.server";

export interface AppSettingsData {
  plan: string;
  resendApiKey: string;
  fromEmail: string;
  senderName: string;
  enableTrackingEmails: boolean;
  enableReviewEmails: boolean;
  reviewRequestDelayDays: number;
  enableCoupon: boolean;
  couponCode: string;
  couponDiscountPercent: number;
  couponExpiryDays: number;
  brandColor: string;
  cancellationWindowHours: number;
  whatsappNumber: string;
}

export const DEFAULT_SETTINGS: AppSettingsData = {
  plan: "free",
  resendApiKey: "",
  fromEmail: "",
  senderName: "",
  enableTrackingEmails: true,
  enableReviewEmails: false,
  reviewRequestDelayDays: 7,
  enableCoupon: false,
  couponCode: "",
  couponDiscountPercent: 10,
  couponExpiryDays: 30,
  brandColor: "#5c6ac4",
  cancellationWindowHours: 2,
  whatsappNumber: "",
};

/**
 * Load settings for a shop.
 * Returns defaults merged with stored values — never null.
 */
export async function getSettings(shop: string): Promise<AppSettingsData> {
  const row = await prisma.appSettings
    .findUnique({ where: { shop } })
    .catch(() => null);

  if (!row) return { ...DEFAULT_SETTINGS };

  return {
    plan: row.plan,
    resendApiKey: row.resendApiKey,
    fromEmail: row.fromEmail,
    senderName: row.senderName,
    enableTrackingEmails: row.enableTrackingEmails,
    enableReviewEmails: row.enableReviewEmails,
    reviewRequestDelayDays: row.reviewRequestDelayDays,
    enableCoupon: row.enableCoupon,
    couponCode: row.couponCode,
    couponDiscountPercent: row.couponDiscountPercent,
    couponExpiryDays: row.couponExpiryDays,
    brandColor: row.brandColor,
    cancellationWindowHours: row.cancellationWindowHours,
    whatsappNumber: row.whatsappNumber,
  };
}

/**
 * Create or update settings for a shop.
 * Pass only the fields you want to change.
 */
export async function upsertSettings(
  shop: string,
  data: Partial<AppSettingsData>
): Promise<void> {
  await prisma.appSettings.upsert({
    where: { shop },
    create: { shop, ...DEFAULT_SETTINGS, ...data },
    update: data,
  });
}
