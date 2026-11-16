/**
 * #settings-0 — Settings shows one category at a time. The URL hash picks it:
 * a category id (`#ai`) or the id of a block inside one (`#delete-account`
 * opens Privacy & data and scrolls to the block), so every existing link
 * into Settings keeps working.
 */
export type SettingsPaneShape = {
  id: string;
  blocks: readonly { id?: string }[];
};

/** The category the hash opens, or `null` when the hash names none (the index). */
export function settingsPaneFor<C extends SettingsPaneShape>(
  categories: readonly C[],
  hash: string | null | undefined,
): C | null {
  const target = (hash ?? "").replace(/^#/, "");
  if (!target) return null;
  return (
    categories.find((category) => category.id === target) ??
    categories.find((category) => category.blocks.some((block) => block.id === target)) ??
    null
  );
}
