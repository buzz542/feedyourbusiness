import { formatInterval, formatMoney, type PriceTerms } from "@/server/billing/terms";

export interface TrialReminderInput {
  chargeDate: Date;
  price: PriceTerms;
  settingsUrl: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** DMCC reminder: sent before a free trial turns into a paid subscription. A service email. */
export function renderTrialReminder(input: TrialReminderInput): RenderedEmail {
  const when =
    new Intl.DateTimeFormat("en-US", {
      dateStyle: "long",
      timeStyle: "short",
      timeZone: "Europe/London",
    }).format(input.chargeDate) + " UK time";
  const amount = formatMoney(input.price.unitAmount, input.price.currency);
  const every = formatInterval(input.price.interval, input.price.intervalCount);

  const subject = "Your AskedFor trial ends soon";
  const lead = `Your AskedFor free trial ends on ${when}.`;
  const charge = `Your card is charged ${amount} then, and again every ${every} until you cancel.`;
  const how = "To avoid the charge, cancel before then. It takes two clicks in Settings.";
  const footer = "This is a service email about your subscription.";

  const text = [lead, "", charge, "", `${how}`, input.settingsUrl, "", footer].join("\n");
  const html = [
    `<p>${escapeHtml(lead)}</p>`,
    `<p>${escapeHtml(charge)}</p>`,
    `<p>${escapeHtml(how)} <a href="${escapeHtml(input.settingsUrl)}">Open Settings</a></p>`,
    `<p>${escapeHtml(footer)}</p>`,
  ].join("\n");

  return { subject, text, html };
}
