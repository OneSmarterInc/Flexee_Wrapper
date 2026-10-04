import "server-only";

/**
 * The mail adapter (Spec 17 §1). One real implementation — Resend over its HTTPS API — plus a
 * transport tests can install.
 *
 * Three rules this file exists to keep:
 *
 *  - **It never throws.** Every caller is in the middle of something that must still finish: a
 *    student's account is created whether or not their invitation left the building. The result
 *    says what happened; a failure is data, never an exception. The stub this replaced threw
 *    whenever a provider was configured, so configuring one would have turned forgot-password
 *    into a server error.
 *  - **It never logs a link, a token, an address or a name.** The stub logged the recipient and
 *    the whole message body, reset links included, on every send. What is logged here is a
 *    provider status code and nothing else.
 *  - **With no API key, nothing is sent and the result says so**, with the reason
 *    "not configured", so the caller can record "not sent" and offer the link another way.
 *
 * Spec 13 (announcements) reuses `sendMail` as it stands.
 */

export type Mail = { to: string; subject: string; text: string; html?: string };
export type MailResult = { ok: boolean; error?: string; id?: string };

/** Why a send did not happen. Stored and shown, so it is a stable string, not a sentence. */
export const NOT_CONFIGURED = "not configured";

export type MailTransport = (msg: Mail) => Promise<MailResult> | MailResult;

let transport: MailTransport | null = null;
/** Install a transport (the test fake). Pass null to go back to the configured provider. */
export function setMailTransport(t: MailTransport | null) { transport = t; }

/** True when a provider is configured, so a caller can say "not sent" without trying. */
export function mailConfigured() {
  return transport != null || !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);
}

export async function sendMail(msg: Mail): Promise<MailResult> {
  if (transport) {
    try { return await transport(msg); }
    catch (e: any) { return { ok: false, error: short(e?.message) }; }
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.MAIL_FROM;
  if (!key || !from) return { ok: false, error: NOT_CONFIGURED };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from, to: [msg.to], subject: msg.subject, text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      }),
    });
    if (!res.ok) {
      // The status only. A provider's error body can quote the recipient back at us.
      console.warn(`[mail] provider refused a message: HTTP ${res.status}`);
      return { ok: false, error: `provider error ${res.status}` };
    }
    const body = await res.json().catch(() => null);
    return { ok: true, id: typeof body?.id === "string" ? body.id : undefined };
  } catch {
    console.warn("[mail] could not reach the provider");
    return { ok: false, error: "could not reach the provider" };
  }
}

// A transport's own message could name anything, and the reason is stored and shown. Keep it
// short, and strip whatever looks like an address or a link first.
function short(m: unknown) {
  const s = typeof m === "string" && m ? m : "send failed";
  return s.replace(/\S+@\S+/g, "[address]").replace(/https?:\/\/\S+/g, "[link]").slice(0, 120);
}
