/** The longest display name the web form accepts. */
export const DISPLAY_NAME_MAX = 80;

/**
 * The name a person chose, or null when there is none. Accounts admitted
 * without a name carry their email in the name column, so a name equal to
 * the email (or blank) counts as no name: the screen then shows the email
 * once instead of twice.
 */
export function displayNameOf(
  name: string | null | undefined,
  email: string | null | undefined,
): string | null {
  const trimmed = (name ?? "").trim();
  if (trimmed.length === 0) return null;
  if (email && trimmed.toLowerCase() === email.trim().toLowerCase()) return null;
  return trimmed;
}

/** The first letter for an avatar circle: the name's, else the email's. */
export function avatarInitial(
  name: string | null | undefined,
  email: string | null | undefined,
): string {
  const source = displayNameOf(name, email) ?? (email ?? "").trim();
  return (Array.from(source)[0] ?? "?").toLocaleUpperCase();
}

/** A typed name ready to save, or null when it is blank or too long. */
export function cleanDisplayName(input: string): string | null {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (trimmed.length === 0 || trimmed.length > DISPLAY_NAME_MAX) return null;
  return trimmed;
}
