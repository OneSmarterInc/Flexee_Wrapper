// How each upload status reads on the library pages.
export const STATUS: Record<string, [string, string]> = {
  checking: ["Checking…", "var(--muted)"], ready: ["Ready to add", "var(--navy)"], stopped: ["Stopped — see report", "var(--danger)"],
  failed: ["Failed", "var(--danger)"], publishing: ["Adding to library…", "var(--muted)"], published: ["In the library", "var(--navy)"],
};
