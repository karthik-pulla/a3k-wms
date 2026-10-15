/**
 * Sending texts and emails for urgent mentions. STUB: nothing is sent yet. A server-side implementation
 * (e.g. AWS SNS for text, SES for email) replaces this; the escalation check only calls this interface.
 */
export interface Notifier {
  text(userId: string, body: string): Promise<void>;
  email(userId: string, subject: string, body: string): Promise<void>;
}

export const stubNotifier: Notifier = {
  async text(userId, body) { console.info(`[notify stub] text to ${userId}: ${body}`); },
  async email(userId, subject, body) { console.info(`[notify stub] email to ${userId}: ${subject} — ${body}`); },
};
