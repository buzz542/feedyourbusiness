import "server-only";
import { Resend } from "resend";
import type { Mailer } from "@/server/billing/trial-reminders";

export class MailerNotConfiguredError extends Error {
  constructor() {
    super("RESEND_API_KEY and EMAIL_FROM must be set");
    this.name = "MailerNotConfiguredError";
  }
}

type Env = Readonly<Record<string, string | undefined>>;

/** Throws when not configured. A reminder that silently never sends is a compliance failure. */
export function createResendMailer(env: Env = process.env): Mailer {
  const apiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  if (!apiKey || !from) throw new MailerNotConfiguredError();

  const resend = new Resend(apiKey);
  return {
    async send({ to, subject, text, html, headers, idempotencyKey }) {
      const { error } = await resend.emails.send(
        {
          from,
          to,
          subject,
          text,
          html,
          ...(headers ? { headers } : {}),
        },
        idempotencyKey ? { idempotencyKey } : undefined,
      );
      if (error) throw new Error(`Resend rejected the message: ${error.name}`);
    },
  };
}
