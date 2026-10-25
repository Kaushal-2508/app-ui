/**
 * Escape a string for safe interpolation into an HTML template that will be
 * assigned to `innerHTML` (e.g. the html2pdf report generators). User-supplied
 * fields — student `full_name`, roll numbers, topic tags — are attacker-
 * controlled (a student can set their own display name), so interpolating them
 * raw is a stored-XSS sink that fires in the staff/admin browser when a report
 * is generated. Always wrap such fields in this before templating.
 */
export function escapeHtml(raw: string | number | null | undefined): string {
  if (raw == null) return "";
  return String(raw)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
