import type { I18n } from "@lingui/core";
import type {
  EvidenceLibraryResult,
  PreventiveCareResult,
  PreventiveItemView,
} from "@openvalens/api/preventive-care-contract";
import { isValidIsoDate } from "@openvalens/api/preventive-care-contract";
import {
  evidenceEntryCard,
  LIBRARY_COPY,
  PREVENTIVE_COPY,
  preventiveItemCard,
  preventivePageNotes,
  type EvidenceEntryCard,
  type PreventiveItemCard,
} from "@openvalens/api/presenters/preventive-care";

/**
 * Issue #97 — native layout model for the preventive-care screen.
 * Dependency-free (no RPC client / Varlock) so it is unit-tested directly.
 * It flattens the shared view models from
 * `@openvalens/api/presenters/preventive-care`, so the native screen shows
 * exactly what the web page shows: the same items, grades, citations with
 * dates, eligibility prompts and states.
 */

export type PreventiveScreenModel = {
  title: string;
  intro: string;
  /** No region / adults only / owner only: an explanation instead of a list. */
  statusText: string | null;
  showProfileLink: boolean;
  notes: string[];
  criteria: PreventiveCareResult["criteria"];
  items: { card: PreventiveItemCard; view: PreventiveItemView }[];
  notShown: string[];
  disclaimer: string;
  versionText: string;
  canEdit: boolean;
  libraryEnabled: boolean;
};

export function preventiveScreenModel(
  i18n: I18n,
  result: PreventiveCareResult,
): PreventiveScreenModel {
  const page = preventivePageNotes(i18n, result);
  const available = result.status === "available";
  return {
    title: i18n._(PREVENTIVE_COPY.pageTitle),
    intro: i18n._(PREVENTIVE_COPY.pageIntro),
    statusText: page.statusText,
    showProfileLink:
      result.status === "no_region" || result.status === "adult_confirmation_required",
    notes: page.notes,
    criteria: available ? result.criteria : [],
    items: available
      ? result.items.map((view) => ({ card: preventiveItemCard(i18n, view), view }))
      : [],
    notShown: available ? result.notShown.map((entry) => entry.title) : [],
    disclaimer: i18n._(PREVENTIVE_COPY.disclaimer),
    versionText: page.versionText,
    canEdit: available && result.canEdit,
    libraryEnabled: result.libraryEnabled,
  };
}

export function libraryModel(
  i18n: I18n,
  library: EvidenceLibraryResult | undefined,
): {
  text: string;
  cards: EvidenceEntryCard[];
} {
  if (!library || !library.enabled) return { text: i18n._(LIBRARY_COPY.off), cards: [] };
  return {
    text: i18n._(LIBRARY_COPY.intro),
    cards: library.entries.map((entry) => evidenceEntryCard(i18n, entry)),
  };
}

/** A typed date (YYYY-MM-DD), `null` for blank, or `undefined` when invalid. */
export function parseTypedDate(text: string): string | null | undefined {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  return isValidIsoDate(trimmed) ? trimmed : undefined;
}
