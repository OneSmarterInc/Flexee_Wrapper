// Due dates are entered and shown in the institution's time zone (APP_TIMEZONE, default US Eastern),
// not the server's: a browser's date-time field has no zone, and a server in UTC would otherwise move a
// 11:59 PM Dayton deadline five hours earlier.
export const APP_TZ = process.env.APP_TIMEZONE || "America/New_York";

function offsetMinutes(at: Date, tz: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    .formatToParts(at).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return (asUtc - at.getTime()) / 60000;
}

/** "2027-02-01T23:59" in the institution's zone -> the exact instant. Empty -> null; invalid -> Invalid Date. */
export function parseLocal(value: string | null | undefined, tz = APP_TZ): Date | null {
  const v = (value ?? "").trim(); if (!v) return null;
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/); if (!m) return new Date(NaN);
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  let at = new Date(guess - offsetMinutes(new Date(guess), tz) * 60000);
  at = new Date(guess - offsetMinutes(at, tz) * 60000); // settle across a daylight-saving change
  // A spring-forward time such as 02:30 never occurs; Date.UTC also normalizes impossible
  // calendar dates. Refuse either instead of silently moving the deadline.
  return toLocalInput(at, tz) === v ? at : new Date(NaN);
}

/** An instant -> "2027-02-01T23:59" in the institution's zone, for a date-time field. */
export function toLocalInput(at: Date | null | undefined, tz = APP_TZ) {
  if (!at) return "";
  const shifted = new Date(at.getTime() + offsetMinutes(at, tz) * 60000);
  return shifted.toISOString().slice(0, 16);
}

/** An instant as people read it: "Mon, Feb 1, 11:59 PM EST". */
export function formatLocal(at: Date | null | undefined, tz = APP_TZ) {
  if (!at) return "No due date";
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(at);
}
