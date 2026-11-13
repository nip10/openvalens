/**
 * Drinks presentation shared by web and native (Issue #443, part b). Pure;
 * imports only the zod-only contract and the client-safe drink data.
 *
 * Copy rules: personal record-keeping only. Totals are facts with their
 * coverage; an unknown value is never zero. There are no alcohol limits or
 * guidelines, and the caffeine reference is a number with its source, never
 * "you went over". Plain water keeps its own subtotal: nothing here adds
 * water to anything, and there is no "total hydration".
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { DRINK_PRESETS, type DrinkPresetKey } from "@openvalens/nutrition/drinks";

import type {
  DrinkSummaryWire,
  DrinkTotalWire,
  LastCaffeineInput,
} from "../contracts/nutrition-drinks";
import { LAST_CAFFEINE_MAX_NIGHTS } from "../contracts/nutrition-drinks";
import { HIDDEN_VALUE } from "./nutrition-targets";

export { DRINK_PRESETS };

export const DRINK_PRESET_LABELS: Readonly<Record<DrinkPresetKey, MessageDescriptor>> =
  Object.freeze({
    espresso: msg`Espresso`,
    filter_coffee: msg`Mug of filter coffee`,
    tea: msg`Tea`,
    cola: msg`Cola`,
    energy_drink: msg`Energy drink`,
    beer: msg`Beer`,
    wine: msg`Glass of wine`,
    spirits: msg`Shot of spirits`,
  });

export const DRINKS_COPY = Object.freeze({
  title: msg`Drinks`,
  intro: msg`A drink is saved at once as a food in the current meal, with its values from USDA FoodData Central. You can change the amount afterwards. Plain water has its own subtotal.`,
  unavailable: msg`Drink shortcuts need the USDA FoodData Central catalog on this server. Your server operator can import it; until then, search for the drink or add it by hand.`,
  saveFailed: msg`Could not save the drink. Nothing was changed.`,
  caffeine: msg`Caffeine`,
  alcohol: msg`Alcohol`,
  hidden: msg`Caffeine and alcohol totals are hidden while numbers are hidden.`,
  caffeineSettingLabel: msg`Show a caffeine total`,
  caffeineSettingDescription: msg`Off by default. Adds up the caffeine in the foods and drinks you log and shows how many of them reported it. Foods that don't report caffeine count as unknown, never as zero. Also shows the time of your last caffeine on the sleep page. Turn it off at any time.`,
  alcoholSettingLabel: msg`Show an alcohol total`,
  alcoholSettingDescription: msg`Off by default. Adds up the alcohol in grams in the foods and drinks you log and, where your region has a published definition, in standard drinks. Foods that don't report alcohol count as unknown, never as zero. Turn it off at any time.`,
  incomplete: msg`Not every food reported this, so the total is at least this much.`,
  referenceAdultsOnly: msg`The caffeine reference is for adults only, so it is not shown.`,
  referenceNotShown: msg`The caffeine reference is not shown because of an answer in your nutrition settings.`,
  noDefinition: msg`Shown in grams only. Standard drinks need your region in your profile; OpenValens has a published definition for the United States, the United Kingdom and Portugal.`,
  source: msg`Source`,
  notAdvice: msg`A record of what you logged, not medical advice.`,
  pendingSync: msg`Foods still waiting to sync are added to these totals once they sync.`,
});

const PRESET_BY_KEY = new Map(DRINK_PRESETS.map((entry) => [entry.key, entry]));

/** "Espresso · 30 ml". */
export function drinkPresetLabel(key: DrinkPresetKey, i18n: I18n): string {
  const name = i18n._(DRINK_PRESET_LABELS[key]);
  const volume = PRESET_BY_KEY.get(key)?.volumeMl;
  return volume === undefined ? name : `${name} · ${volume.toLocaleString(i18n.locale)} ml`;
}

function decimal(value: number, digits: number, i18n: I18n): string {
  return value.toLocaleString(i18n.locale, { maximumFractionDigits: digits });
}

export function drinkCoverageText(total: DrinkTotalWire): MessageDescriptor {
  if (total.totalEntries === 0) return msg`Nothing logged`;
  const known = total.knownEntries;
  return msg`${known} of ${plural(total.totalEntries, { one: "# food", other: "# foods" })} reported a value`;
}

/** "163 mg", "at least 163 mg", "Unknown", or the hidden placeholder. */
export function formatCaffeineTotal(
  total: DrinkTotalWire,
  i18n: I18n,
  hideNumbers: boolean,
): string {
  if (hideNumbers) return i18n._(HIDDEN_VALUE);
  if (total.amount === null)
    return total.totalEntries === 0 ? i18n._(msg`Nothing logged`) : i18n._(msg`Unknown`);
  const amount = `${decimal(total.amount, 0, i18n)} mg`;
  return total.atLeast ? i18n._(msg`at least ${amount}`) : amount;
}

/** "15.6 g", "at least 15.6 g", "Unknown", or the hidden placeholder. */
export function formatAlcoholTotal(
  total: DrinkTotalWire,
  i18n: I18n,
  hideNumbers: boolean,
): string {
  if (hideNumbers) return i18n._(HIDDEN_VALUE);
  if (total.amount === null)
    return total.totalEntries === 0 ? i18n._(msg`Nothing logged`) : i18n._(msg`Unknown`);
  const amount = `${decimal(total.amount, 1, i18n)} g`;
  return total.atLeast ? i18n._(msg`at least ${amount}`) : amount;
}

type AlcoholReady = Extract<DrinkSummaryWire["alcohol"], { status: "ready" }>;
type CaffeineReady = Extract<DrinkSummaryWire["caffeine"], { status: "ready" }>;

/** "1.6 standard drinks" / "1.9 UK units"; `null` without a definition or an amount. */
export function formatStandardDrinks(
  alcohol: AlcoholReady,
  i18n: I18n,
  hideNumbers: boolean,
): string | null {
  if (hideNumbers || alcohol.definition === null || alcohol.standardDrinks === null) return null;
  const count = alcohol.standardDrinks;
  const value = decimal(count, 1, i18n);
  const text =
    alcohol.definition.unit === "uk_unit"
      ? i18n._(msg`${plural(count, { one: `${value} UK unit`, other: `${value} UK units` })}`)
      : i18n._(
          msg`${plural(count, { one: `${value} standard drink`, other: `${value} standard drinks` })}`,
        );
  return alcohol.total.atLeast ? i18n._(msg`at least ${text}`) : text;
}

/** "1 standard drink = 10 g of pure alcohol (DGS, Norma 030/2012)". */
export function describeStandardDrink(
  definition: NonNullable<AlcoholReady["definition"]>,
  i18n: I18n,
): string {
  const grams = definition.grams;
  const org = definition.org;
  const document = definition.document;
  return definition.unit === "uk_unit"
    ? i18n._(msg`1 UK unit = ${grams} g of pure alcohol (${org}, ${document})`)
    : i18n._(msg`1 standard drink = ${grams} g of pure alcohol (${org}, ${document})`);
}

/** "EFSA reference for adults: 400 mg a day" — a number only, never a comparison. */
export function describeCaffeineReference(
  reference: NonNullable<CaffeineReady["reference"]>,
  i18n: I18n,
): string {
  const org = reference.org;
  const amount = decimal(reference.mgPerDay, 0, i18n);
  return i18n._(msg`${org} reference for adults: ${amount} mg a day`);
}

export function caffeineReferenceNote(
  note: CaffeineReady["referenceNote"],
): MessageDescriptor | null {
  if (note === "adults_only") return DRINKS_COPY.referenceAdultsOnly;
  if (note === "not_shown") return DRINKS_COPY.referenceNotShown;
  return null;
}

/** "Last caffeine 16:40", given the time already formatted for the member. */
export function lastCaffeineText(time: string, i18n: I18n): string {
  return i18n._(msg`Last caffeine ${time}`);
}

/** Nights as the sleep summary returns them. Structural, so it accepts the wire output. */
export type SleepNightLike = {
  date: string;
  mainSleepStart: string | null;
  mainSleepEnd: string | null;
};

const HOUR = 3_600_000;

/**
 * One window per night: from the end of the night before (at most 24 hours
 * back) to when this night's main sleep started. Nights without a start are
 * left out, and at most the latest 31 are kept.
 */
export function caffeineWindowsForNights(nights: readonly SleepNightLike[]): LastCaffeineInput {
  const timed = nights
    .filter((night) => night.mainSleepStart && !Number.isNaN(Date.parse(night.mainSleepStart)))
    .map((night) => ({
      key: night.date,
      start: Date.parse(night.mainSleepStart!),
      end: night.mainSleepEnd ? Date.parse(night.mainSleepEnd) : Number.NaN,
    }))
    .sort((a, b) => a.start - b.start);
  const windows = timed.map((night, index) => {
    const earliest = night.start - 24 * HOUR;
    const previousEnd = index > 0 ? timed[index - 1]!.end : Number.NaN;
    const from =
      Number.isFinite(previousEnd) && previousEnd > earliest && previousEnd < night.start
        ? previousEnd
        : earliest;
    return {
      key: night.key,
      from: new Date(from).toISOString(),
      to: new Date(night.start).toISOString(),
    };
  });
  return { nights: windows.slice(-LAST_CAFFEINE_MAX_NIGHTS) };
}
