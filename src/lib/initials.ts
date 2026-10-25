/**
 * The single initials algorithm for the whole app.
 *
 * Before this existed the logic was reimplemented ~14 times with three
 * different behaviours, so "Chetan Sharma" rendered as "CS" in AppSidebar but
 * "CH" in ViewUserSheet. Every avatar surface must call this.
 */
export function getInitials(name?: string | null, email?: string | null): string {
  const trimmed = (name ?? "").trim();
  if (trimmed) {
    const words = trimmed.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return (words[0].charAt(0) + words[words.length - 1].charAt(0)).toUpperCase();
    }
    return words[0].slice(0, 2).toUpperCase();
  }
  const mail = (email ?? "").trim();
  if (mail) return mail.slice(0, 2).toUpperCase();
  return "?";
}
