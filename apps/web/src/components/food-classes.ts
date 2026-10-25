/**
 * Class strings shared by the Food screens (meal diary, my foods, targets,
 * drafts, supplements). A native `<select>` drawn like `Input` from
 * `@openvalens/ui`, and the running-text link of the Bloom system.
 */
export const nativeSelectClass =
  "h-9 w-full min-w-0 cursor-pointer rounded-md border border-input bg-card px-3 text-sm text-ink transition-colors duration-[var(--dur-short)] hover:bg-muted disabled:cursor-not-allowed disabled:opacity-55 outline-2 -outline-offset-2 outline-transparent focus-visible:outline-ring";

export const textLinkClass =
  "text-ink underline decoration-signal underline-offset-[0.15em] transition-colors duration-[var(--dur-short)] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

/** A link or text button set in the control face, for screen-level links. */
export const controlLinkClass = `text-sm font-semibold ${textLinkClass}`;

/** A quiet in-line control (Retry in an error line, "Use this"): text, underlined. */
export const inlineButtonClass = `cursor-pointer ${textLinkClass} disabled:cursor-not-allowed disabled:opacity-55`;
