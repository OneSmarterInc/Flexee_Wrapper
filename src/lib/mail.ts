import "server-only";
// Pluggable mailer. In dev (no provider configured) it logs the message and the
// link, so every recovery flow works locally; wiring a provider is one adapter.
export async function sendMail(msg: { to: string; subject: string; text: string }) {
  const provider = process.env.MAIL_PROVIDER; // e.g. 'smtp' | 'resend' — adapter goes here
  if (!provider) {
    console.log(`\n[mail:dev] to=${msg.to}\n[mail:dev] subject=${msg.subject}\n[mail:dev] ${msg.text}\n`);
    return { delivered: false, dev: true };
  }
  // TODO: implement the chosen provider (SMTP/API). Left as a single integration point.
  throw new Error(`MAIL_PROVIDER '${provider}' not implemented`);
}
