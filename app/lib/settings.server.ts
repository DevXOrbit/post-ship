/**
 * app/lib/settings.server.ts  — updated with onboarding fields
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
  // ── Onboarding ───────────────────────────────────────────────────────────
  onboardingStep1: boolean;
  onboardingStep2: boolean;
  onboardingStep3: boolean;
  onboardingDone: boolean;
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
  onboardingStep1: false,
  onboardingStep2: false,
  onboardingStep3: false,
  onboardingDone: false,
};

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
    onboardingStep1: row.onboardingStep1 ?? false,
    onboardingStep2: row.onboardingStep2 ?? false,
    onboardingStep3: row.onboardingStep3 ?? false,
    onboardingDone: row.onboardingDone ?? false,
  };
}

export async function upsertSettings(
  shop: string,
  data: Partial<AppSettingsData>,
): Promise<void> {
  await prisma.appSettings.upsert({
    where: { shop },
    create: { shop, ...DEFAULT_SETTINGS, ...data },
    update: data,
  });
}
