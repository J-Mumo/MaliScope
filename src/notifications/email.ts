import { and, asc, eq, or, sql } from "drizzle-orm";
import { getDatabase } from "@/db/client";
import { PostgresDiscoveryRepository } from "@/db/discovery-repository";
import { discoveryNotifications } from "@/db/schema";
import { preScreenDiscoveryDraft } from "@/sources/pre-screen";

interface EmailConfig {
  apiKey: string;
  to: string;
  from: string;
}

export interface DiscoveryNotificationResult {
  configured: boolean;
  attempted: number;
  sent: number;
  failed: number;
  errors: string[];
}

function getEmailConfig(): EmailConfig | null {
  const apiKey = process.env.RESEND_API_KEY;
  const to = process.env.DISCOVERY_ALERT_EMAIL;
  const from = process.env.DISCOVERY_ALERT_FROM;
  return apiKey && to && from ? { apiKey, to, from } : null;
}

function formatMoney(value: string | null | undefined): string {
  return value ? `KES ${Number(value).toLocaleString("en-KE")}` : "Not reported";
}

function buildEmail(record: Awaited<ReturnType<PostgresDiscoveryRepository["get"]>>) {
  if (!record) return null;
  const screen = preScreenDiscoveryDraft(record.draft);
  const unitMix = record.draft.unitHints
    .filter((hint) => hint.count.value)
    .map((hint) => `${hint.count.value} ${hint.label}`)
    .join(", ");
  const subject = `MaliScope: promising property${record.title ? ` — ${record.title}` : ""}`;
  const text = [
    "A new high-quality property was found by MaliScope discovery.",
    "",
    `Title: ${record.title ?? "Not reported"}`,
    `County: ${record.county ?? "Not reported"}`,
    `Submarket: ${record.submarket ?? "Not reported"}`,
    `Asking price: ${formatMoney(record.askingPriceKsh)}`,
    `Reported gross monthly rent: ${formatMoney(screen.reportedMonthlyGrossRentKsh)}`,
    `Reported units: ${unitMix || "Not reported"}`,
    `Policy screen: ${screen.label}`,
    `Debt-service coverage ratio: ${screen.debtServiceCoverageRatio ?? "Not calculated"}`,
    `Maximum allowable offer: ${formatMoney(screen.maximumAllowableOfferKsh)}`,
    "",
    `Source: ${record.sourceUrl}`,
    "",
    "This is a provisional discovery alert. Verify the source facts, title, rent roll, occupancy, expenses, and due diligence before relying on it.",
  ].join("\n");
  return { subject, text };
}

async function sendEmail(config: EmailConfig, subject: string, text: string) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: config.from, to: [config.to], subject, text }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Email provider returned HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
}

export async function sendPendingDiscoveryNotifications(
  limit = 50,
): Promise<DiscoveryNotificationResult> {
  const config = getEmailConfig();
  const result: DiscoveryNotificationResult = {
    configured: Boolean(config),
    attempted: 0,
    sent: 0,
    failed: 0,
    errors: [],
  };
  if (!config) return result;

  const database = getDatabase();
  const repository = new PostgresDiscoveryRepository();
  const pending = await database
    .select({ id: discoveryNotifications.id })
    .from(discoveryNotifications)
    .where(
      or(
        eq(discoveryNotifications.status, "pending"),
        eq(discoveryNotifications.status, "failed"),
      ),
    )
    .orderBy(asc(discoveryNotifications.createdAt))
    .limit(limit);

  for (const candidate of pending) {
    const [claimed] = await database
      .update(discoveryNotifications)
      .set({
        status: "sending",
        attempts: sql`${discoveryNotifications.attempts} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(discoveryNotifications.id, candidate.id),
          or(
            eq(discoveryNotifications.status, "pending"),
            eq(discoveryNotifications.status, "failed"),
          ),
        ),
      )
      .returning({ id: discoveryNotifications.id });
    if (!claimed) continue;

    result.attempted += 1;
    const notification = await database
      .select({ discoveryId: discoveryNotifications.discoveryId })
      .from(discoveryNotifications)
      .where(eq(discoveryNotifications.id, candidate.id))
      .limit(1);
    const record = notification[0]
      ? await repository.get(notification[0].discoveryId)
      : null;
    const email = buildEmail(record);
    try {
      if (!email) throw new Error("Discovery record for notification was not found.");
      await sendEmail(config, email.subject, email.text);
      await database
        .update(discoveryNotifications)
        .set({ status: "sent", sentAt: new Date(), updatedAt: new Date() })
        .where(eq(discoveryNotifications.id, candidate.id));
      result.sent += 1;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      await database
        .update(discoveryNotifications)
        .set({ status: "failed", lastError: message, updatedAt: new Date() })
        .where(eq(discoveryNotifications.id, candidate.id));
      result.failed += 1;
      result.errors.push(message);
    }
  }
  return result;
}
