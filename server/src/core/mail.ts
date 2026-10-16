// Emails people get: invites, access resets, "support has access". On AWS they go out through SES; until a sending
// domain is set up (and always in the preview), they aren't sent, and whoever made the link copies it from the screen.

export interface Mail { to: string; subject: string; text: string }
export interface Mailer {
  /** true if it was sent */
  send(m: Mail): Promise<boolean>;
}

export const noMail: Mailer = { send: async () => false };

/** Collects what would have been sent (the preview shows it; tests read it) */
export function outbox(): Mailer & { sent: Mail[] } {
  const sent: Mail[] = [];
  return { sent, send: async m => { sent.push(m); return true; } };
}

export const inviteMail = (o: { to: string; name: string; warehouse: string; link: string; kind: "invite" | "reset"; from: string }): Mail => ({
  to: o.to,
  subject: o.kind === "invite" ? `You're invited to ${o.warehouse}` : `Set up your ${o.warehouse} sign-in again`,
  text: [
    `Hi ${o.name},`,
    "",
    o.kind === "invite"
      ? `${o.from} invited you to the warehouse system of ${o.warehouse}. Open this link to choose a password and connect an authenticator app on your phone:`
      : `${o.from} reset your sign-in. Open this link to choose a new password and connect your authenticator app again:`,
    "",
    o.link,
    "",
    o.kind === "invite" ? "The link works for 7 days." : "The link works for 24 hours. Your old password and phone no longer work.",
    "If you didn't expect this, you can ignore it.",
  ].join("\n"),
});
