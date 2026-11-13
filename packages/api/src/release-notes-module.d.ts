/**
 * The Highlights of this server's own version (#446), compiled in at build time
 * from `docs/releases/vX.Y.Z.md` (and `vX.Y.Z.pt-PT.md` when present) by
 * `scripts/release-notes.ts`. Null when the version has no notes yet.
 */
declare module "virtual:openvalens/release-notes" {
  type Block = { kind: "list"; items: string[] } | { kind: "paragraph"; text: string };
  const notes: {
    version: string;
    date: string;
    highlights: { en: Block[]; "pt-PT": Block[] | null };
  } | null;
  export default notes;
}
