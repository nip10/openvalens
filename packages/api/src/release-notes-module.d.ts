/**
 * The Highlights of this server's own version (#446), compiled in at build time
 * from `docs/releases/vX.Y.Z.md` (and `vX.Y.Z.pt-PT.md` when present) by
 * `scripts/release-notes.ts`. Null when the version has no notes yet.
 * `history` holds every release up to this one, newest first: the changelog
 * in Settings › What's new.
 */
declare module "virtual:openvalens/release-notes" {
  type Block = { kind: "list"; items: string[] } | { kind: "paragraph"; text: string };
  type Notes = {
    version: string;
    date: string;
    highlights: { en: Block[]; "pt-PT": Block[] | null };
    /** One short line per list item, in order. */
    headlines?: { en: string[]; "pt-PT": string[] | null };
  };
  const notes: Notes | null;
  export const history: Notes[] | undefined;
  export default notes;
}
