/**
 * Typed one-liners for quick logging (#440d): "500 ml", "peso 82,4",
 * "bp 120/80 62", "slept 7h30", "took magnesium", "sauna 20 min at 8",
 * drink presets ("espresso", "beer 330", "wine glass", "café", "imperial",
 * #443) and pain ("pain left knee 4", "dor joelho esquerdo 4", #442). Rules
 * only, no AI, so it works offline too. Pure TypeScript — safe for the app
 * bundles; the web palette uses it now and the mobile picker can later.
 *
 * A one-liner never saves on its own. It becomes quick form values for one
 * kind (`entry`), the kinds a bare number could be (`choices`), the workout
 * form with the text filled in, or food (drafts or search). The caller shows
 * a preview ({@link previewOneLinerEntry}) and saves on Enter through
 * `buildQuickLogWrite`, the same path as the quick form, so every range check
 * and unit conversion is shared. Numbers stay as typed and go through the
 * shared decimal parser (#448) there.
 */
import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { parseDecimal } from "@openvalens/i18n/numbers";
import type { DrinkPresetKey } from "@openvalens/nutrition/drinks";
import type { PainType } from "@openvalens/pain/model";
import { parseDuration } from "@openvalens/trackers/model";

import { drinkLogKindId, type BuiltInLogKindId, type LogKind } from "./log-kinds";
import { defaultObservedAt } from "./manual-entry";
import { defaultManualSleepWindow } from "./manual-sleep";
import {
  buildQuickLogWrite,
  hasQuickForm,
  quickLogWriteValue,
  unitKey,
  type QuickLogWrite,
} from "./quick-log";
import {
  matchTrackerOneLiner,
  trackerLogKindId,
  trackerShapeOfLogKind,
  type TrackerForLogKind,
} from "./trackers";

export type OneLinerSupplement = { id: number; name: string; dose: string | null };

export type OneLinerContext = {
  /** The kinds the member can log now (`availableLogKinds`, trackers included). */
  kinds: readonly LogKind[];
  trackers: readonly TrackerForLogKind[];
  supplements: readonly OneLinerSupplement[];
  /** BCP 47 locale for the decimal parser. */
  locale?: string;
  now?: Date;
  /** The unit a weight with no unit is in. */
  weightUnit?: "kg" | "lb";
  /** How often each kind is logged (`quickLog.recents`), to rank bare-number choices. */
  kindCounts?: Readonly<Record<string, number>>;
  /** Food drafts (#73) are turned on: other text goes there instead of food search. */
  foodDrafts?: boolean;
};

export type OneLinerEntry = {
  kind: LogKind;
  /** Quick form values as typed, for `buildQuickLogWrite` or to fill the quick form. */
  values: Record<string, string>;
  /** The local time the member named (`YYYY-MM-DDTHH:MM`), or null for now. */
  at: string | null;
};

export type OneLiner =
  | { type: "entry"; entry: OneLinerEntry }
  /** A bare number: never saved on its own; the first choice is the likeliest. */
  | { type: "choices"; number: string; entries: OneLinerEntry[] }
  | { type: "workout"; text: string }
  | { type: "food"; text: string; drafts: boolean };

export const ONE_LINER_COPY = Object.freeze({
  now: msg({ message: "now", context: "time of an entry" }),
  today: msg`today, {time}`,
  yesterday: msg`yesterday, {time}`,
  checkValue: msg`check the value`,
  choices: msg`Log {number} as…`,
  workout: msg`Log a workout: “{text}”`,
  foodDraft: msg`Make a food draft: “{text}”`,
  foodSearch: msg`Search foods for “{text}”`,
});

/** Lower case without accents, so "Água" and "agua" read the same. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

// ─── Time ────────────────────────────────────────────────────────

type Clock = { hours: number; minutes: number };
type TimeWords = { rest: string; dayOffset: 0 | -1; clock: Clock | null; named: boolean };

const NOW_WORD = /(?:^|\s)(?:now|agora)(?=\s|$)/iu;
const YESTERDAY_WORD = /(?:^|\s)(?:yesterday|ontem)(?=\s|$)/iu;
/** "at 8", "at 8:30", "at 8pm", "às 20h", "às 8h30", "@8". */
const AT_TIME = /(?:^|\s)(?:at|às|as|@)\s*(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm|h)?(?=\s|$)/iu;
/** A bare "22:00"; only tried when the text does not read without it ("dead hang 1:30"). */
const BARE_CLOCK = /(?:^|\s)(\d{1,2}):(\d{2})(?=\s|$)/u;

function clockOf(hoursText: string, minutesText?: string, suffix?: string): Clock | null {
  let hours = Number(hoursText);
  const minutes = minutesText ? Number(minutesText) : 0;
  const meridiem = suffix?.toLowerCase();
  if (meridiem === "am" || meridiem === "pm") {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === "pm" && hours < 12) hours += 12;
    if (meridiem === "am" && hours === 12) hours = 0;
  }
  return hours <= 23 && minutes <= 59 ? { hours, minutes } : null;
}

function extractTime(text: string, bareClock: boolean): TimeWords {
  let rest = ` ${text} `;
  let dayOffset: 0 | -1 = 0;
  let clock: Clock | null = null;
  let named = false;
  if (NOW_WORD.test(rest)) {
    rest = rest.replace(NOW_WORD, " ");
    named = true;
  }
  if (YESTERDAY_WORD.test(rest)) {
    rest = rest.replace(YESTERDAY_WORD, " ");
    dayOffset = -1;
    named = true;
  }
  const at = AT_TIME.exec(rest);
  const atClock = at ? clockOf(at[1]!, at[2], at[3]) : null;
  if (at && atClock) {
    rest = rest.replace(at[0], " ");
    clock = atClock;
    named = true;
  } else if (bareClock) {
    const bare = BARE_CLOCK.exec(rest);
    const bareTime = bare ? clockOf(bare[1]!, bare[2]) : null;
    if (bare && bareTime) {
      rest = rest.replace(bare[0], " ");
      clock = bareTime;
      named = true;
    }
  }
  return { rest: rest.trim().replace(/\s+/g, " "), dayOffset, clock, named };
}

/** A local day plus a clock time; a time later than now today means yesterday. */
function localAt(now: Date, dayOffset: number, clock: Clock | null): Date {
  const date = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + dayOffset,
    clock ? clock.hours : now.getHours(),
    clock ? clock.minutes : now.getMinutes(),
  );
  if (clock && dayOffset === 0 && date.getTime() > now.getTime()) date.setDate(date.getDate() - 1);
  return date;
}

function observedAtOf(time: TimeWords, now: Date): string | null {
  if (time.dayOffset === 0 && time.clock === null) return null;
  return defaultObservedAt(localAt(now, time.dayOffset, time.clock));
}

// ─── Kinds ───────────────────────────────────────────────────────

/** Words that name a kind, in English and pt-PT (folded: no accents). Longest first. */
const KEYWORDS: readonly (readonly [string, BuiltInLogKindId])[] = (
  [
    ["resting heart rate", "resting_heart_rate"],
    ["resting hr", "resting_heart_rate"],
    ["rhr", "resting_heart_rate"],
    ["fc em repouso", "resting_heart_rate"],
    ["fc repouso", "resting_heart_rate"],
    ["heart rate", "heart_rate"],
    ["frequencia cardiaca", "heart_rate"],
    ["hr", "heart_rate"],
    ["fc", "heart_rate"],
    ["pulse", "heart_rate"],
    ["pulso", "heart_rate"],
    ["weight", "weight"],
    ["weighed", "weight"],
    ["peso", "weight"],
    ["water", "water"],
    ["agua", "water"],
    ["steps", "steps"],
    ["passos", "steps"],
    ["active calories", "active_calories"],
    ["calorias ativas", "active_calories"],
    ["distance", "distance"],
    ["distancia", "distance"],
  ] as const
)
  .slice()
  .sort((a, b) => b[0].length - a[0].length);

type UnitWord = { word: string; kind: BuiltInLogKindId; unit: string; factor?: number };

const UNIT_WORDS: readonly UnitWord[] = (
  [
    ...["ml", "mls"].map((word) => ({ word, kind: "water", unit: "ml" })),
    ...["l", "litre", "litres", "liter", "liters", "litro", "litros"].map((word) => ({
      word,
      kind: "water",
      unit: "l",
    })),
    ...["fl oz", "floz", "oz"].map((word) => ({ word, kind: "water", unit: "fl_oz" })),
    ...["kg", "kgs", "kilos", "quilos"].map((word) => ({ word, kind: "weight", unit: "kg" })),
    ...["lb", "lbs", "pounds", "libras"].map((word) => ({ word, kind: "weight", unit: "lb" })),
    { word: "bpm", kind: "heart_rate", unit: "bpm" },
    ...["steps", "passos"].map((word) => ({ word, kind: "steps", unit: "count" })),
    { word: "kcal", kind: "active_calories", unit: "kcal" },
    { word: "km", kind: "distance", unit: "m", factor: 1000 },
    { word: "m", kind: "distance", unit: "m" },
  ] as UnitWord[]
).sort((a, b) => b.word.length - a.word.length);

const SLEEP_WORDS = /^(?:slept|sleep|dormi|sono)(?:\s+(?:for|durante))?\s+(.+)$/;
const SLEEP_RANGE =
  /^(\d{1,2})(?:[:h.](\d{2}))?\s*(?:-|–|—|to|ate|a)\s*(\d{1,2})(?:[:h.](\d{2}))?$/;
const BLOOD_PRESSURE =
  /^(?:(?:bp|blood pressure|pressure|tensao arterial|tensao|pressao arterial|pressao)\s*)?(\d{2,3})\s*\/\s*(\d{2,3})(?:\s*mmhg)?(?:\s+(?:pulse|pulso|hr|fc)?\s*(\d{2,3})(?:\s*bpm)?)?$/;
const SUPPLEMENT_WORDS = /^(?:took|take|taken|tomei|tomar)\s+(.+)$/;
const WORKOUT_WORDS = new Set([
  "ran",
  "run",
  "running",
  "jogged",
  "walked",
  "walk",
  "hiked",
  "cycled",
  "biked",
  "rode",
  "swam",
  "lifted",
  "trained",
  "workout",
  "gym",
  "yoga",
  "corri",
  "corrida",
  "caminhei",
  "caminhada",
  "pedalei",
  "nadei",
  "treinei",
  "treino",
  "ginasio",
]);
/** Single-number kinds a bare number may be, in the order offered when no counts exist. */
const BARE_NUMBER_KINDS: readonly BuiltInLogKindId[] = [
  "weight",
  "water",
  "heart_rate",
  "resting_heart_rate",
  "steps",
  "active_calories",
  "distance",
];
const MAX_CHOICES = 6;
const NUMBER = /^\d+(?:[.,]\d+)?$/;

function keywordOf(text: string): BuiltInLogKindId | null {
  return KEYWORDS.find(([word]) => word === text)?.[1] ?? null;
}

/** Quick form values for one number in a single-value kind. */
function numberValues(
  kind: LogKind,
  raw: string,
  unit: UnitWord | null,
  context: OneLinerContext,
): Record<string, string> | null {
  if (kind.id === "water") return { quantity: raw, [unitKey("quantity")]: unit?.unit ?? "ml" };
  if (kind.id === "weight")
    return { value: raw, [unitKey("value")]: unit?.unit ?? context.weightUnit ?? "kg" };
  if (unit?.factor) {
    const value = parseDecimal(raw, context.locale);
    return value === null ? null : { value: String(Math.round(value * unit.factor)) };
  }
  return { value: raw };
}

function validates(entry: OneLinerEntry, context: OneLinerContext, now: Date): boolean {
  return buildQuickLogWrite(entry.kind, entry.values, {
    timeZone: "UTC",
    newId: () => "check",
    locale: context.locale,
    now,
    supplementDose: (id) => context.supplements.find((item) => item.id === id)?.dose ?? null,
  }).ok;
}

function findSupplement(
  query: string,
  supplements: readonly OneLinerSupplement[],
): OneLinerSupplement | null {
  const named = supplements.map((item) => ({ item, name: fold(item.name.trim()) }));
  const exact = named.find(({ name }) => name === query);
  if (exact) return exact.item;
  // "took magnesium 200mg" names "Magnesium"; the longest name that starts the text wins.
  const prefix = named
    .filter(({ name }) => name && (query.startsWith(`${name} `) || name.startsWith(query)))
    .sort((a, b) => b.name.length - a.name.length)[0];
  if (prefix) return prefix.item;
  return named.find(({ name }) => name.includes(query))?.item ?? null;
}

function sleepMinutes(text: string, locale?: string): number | null {
  const clock = /^(\d{1,2}):([0-5]\d)$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const hours = parseDecimal(text, locale);
  if (hours !== null) return Math.round(hours * 60);
  const seconds = parseDuration(text.replace(/\bhoras?\b/g, "h").replace(/\bminutos?\b/g, "min"));
  return seconds === null ? null : Math.round(seconds / 60);
}

function parseSleep(
  rest: string,
  time: TimeWords,
  kind: LogKind,
  context: OneLinerContext,
  now: Date,
): OneLinerEntry | null {
  const range = SLEEP_RANGE.exec(rest);
  if (range) {
    const bed = clockOf(range[1]!, range[2]);
    const wakeClock = clockOf(range[3]!, range[4]);
    if (!bed || !wakeClock) return null;
    const wake = localAt(now, time.dayOffset, wakeClock);
    const bedtime = new Date(
      wake.getFullYear(),
      wake.getMonth(),
      wake.getDate(),
      bed.hours,
      bed.minutes,
    );
    if (bedtime.getTime() >= wake.getTime()) bedtime.setDate(bedtime.getDate() - 1);
    return {
      kind,
      values: { bedtime: defaultObservedAt(bedtime), wakeAt: defaultObservedAt(wake) },
      at: null,
    };
  }
  const minutes = sleepMinutes(rest, context.locale);
  if (minutes === null || minutes <= 0) return null;
  // Woke at the time named, now when it is morning, else this morning at 7.
  let wake: Date;
  if (time.clock) wake = localAt(now, time.dayOffset, time.clock);
  else if (time.dayOffset === 0 && now.getHours() >= 4 && now.getHours() < 12)
    wake = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
    );
  else {
    const reference = new Date(now.getTime() + time.dayOffset * 86_400_000);
    const [date, clock] = defaultManualSleepWindow(reference).wakeAt.split("T");
    const [year, month, day] = date!.split("-").map(Number) as [number, number, number];
    const [hours, mins] = clock!.split(":").map(Number) as [number, number];
    wake = new Date(year, month - 1, day, hours, mins);
  }
  const bedtime = new Date(wake.getTime() - minutes * 60_000);
  return {
    kind,
    values: { bedtime: defaultObservedAt(bedtime), wakeAt: defaultObservedAt(wake) },
    at: null,
  };
}

/** Splits "330ml" into "330 ml" and "joelho4" into "joelho 4"; hyphens read as spaces. */
function wordsOf(folded: string): string[] {
  return folded
    .replace(/-/g, " ")
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

// ─── Drinks (#443) ───────────────────────────────────────────────

type DrinkWord = { key: DrinkPresetKey; volumeMl?: number };

const drinkWords = (key: DrinkPresetKey, words: readonly string[], volumeMl?: number) =>
  words.map((word) => [word, { key, volumeMl }] as const);

/**
 * Drink names, folded (no accents), in English and pt-PT. A volume here is
 * the name's own: an "imperial" (Lisbon) or a "fino" (Porto) is a 200 ml
 * draught beer, a "caneca" 500 ml. Otherwise the preset's volume applies.
 */
const DRINK_WORDS: ReadonlyMap<string, DrinkWord> = new Map<string, DrinkWord>([
  ...drinkWords("espresso", [
    "espresso",
    "expresso",
    "cafe",
    "cafe expresso",
    "cafe espresso",
    "bica",
    "cimbalino",
  ]),
  ...drinkWords("filter_coffee", [
    "coffee",
    "filter coffee",
    "mug of coffee",
    "mug of filter coffee",
    "cup of coffee",
    "cafe de filtro",
    "cafe filtrado",
    "caneca de cafe",
  ]),
  ...drinkWords("tea", ["tea", "black tea", "cup of tea", "cha", "cha preto", "chavena de cha"]),
  ...drinkWords("cola", ["cola", "coke", "coca cola", "refrigerante de cola"]),
  ...drinkWords("energy_drink", ["energy drink", "bebida energetica", "energetica", "energetico"]),
  ...drinkWords("beer", ["beer", "cerveja", "lata de cerveja", "garrafa de cerveja"]),
  ...drinkWords("beer", ["imperial", "fino"], 200),
  ...drinkWords("beer", ["caneca", "caneca de cerveja"], 500),
  ...drinkWords("wine", [
    "wine",
    "wine glass",
    "glass of wine",
    "red wine",
    "white wine",
    "glass of red",
    "glass of white",
    "glass of red wine",
    "glass of white wine",
    "vinho",
    "copo de vinho",
    "copo de vinho tinto",
    "copo de vinho branco",
    "vinho tinto",
    "vinho branco",
    "copo de tinto",
    "copo de branco",
  ]),
  ...drinkWords("spirits", [
    "spirits",
    "shot",
    "shot of spirits",
    "vodka",
    "gin",
    "rum",
    "whisky",
    "whiskey",
    "tequila",
    "brandy",
    "aguardente",
    "bagaco",
  ]),
]);

const DRINK_UNITS: Readonly<Record<string, string>> = { ml: "ml", cl: "cl", l: "l" };
const LEADING_ARTICLES = new Set(["a", "an", "one", "um", "uma"]);

/**
 * "espresso", "beer 330", "beer 33 cl", "wine glass", "imperial": the
 * preset and the volume as typed (`""` for the preset's own).
 */
function readDrink(folded: string): { key: DrinkPresetKey; volume: string; unit: string } | null {
  const words = wordsOf(folded);
  const numbers = words.flatMap((word, index) => (NUMBER.test(word) ? [index] : []));
  if (numbers.length > 1) return null;
  let volume = "";
  let unit = "ml";
  const rest = [...words];
  if (numbers.length === 1) {
    const index = numbers[0]!;
    volume = words[index]!;
    const typedUnit = DRINK_UNITS[words[index + 1] ?? ""];
    rest.splice(index, typedUnit ? 2 : 1);
    if (typedUnit) unit = typedUnit;
  }
  if (rest.length > 1 && LEADING_ARTICLES.has(rest[0]!)) rest.shift();
  const word = DRINK_WORDS.get(rest.join(" "));
  if (!word) return null;
  if (!volume && word.volumeMl !== undefined) volume = String(word.volumeMl);
  return { key: word.key, volume, unit };
}

// ─── Pain (#442) ─────────────────────────────────────────────────

const PAIN_WORDS = new Set(["pain", "sore", "hurts", "hurt", "dor", "dores", "doi"]);
/** Small words between the pain word, the part and the rating ("dor no joelho"). */
const PAIN_FILLER = new Set(
  "in on my the of no na nos nas do da dos das de em o a os as meu minha".split(" "),
);
const PAIN_SIDES: ReadonlyMap<string, "left" | "right"> = new Map([
  ...(["left", "l", "esquerdo", "esquerda", "esq"] as const).map((w) => [w, "left"] as const),
  ...(["right", "r", "direito", "direita", "dir"] as const).map((w) => [w, "right"] as const),
]);
const PAIN_TYPE_WORDS: ReadonlyMap<string, PainType> = new Map<string, PainType>([
  ...["ache", "aching", "achy", "dull", "surda", "moinha"].map((w) => [w, "ache"] as const),
  ...["sharp", "stabbing", "aguda", "agudo", "pontada"].map((w) => [w, "sharp"] as const),
  ...["burning", "ardor", "ardencia", "arder"].map((w) => [w, "burning"] as const),
  ...["throbbing", "pulsing", "latejante", "latejar"].map((w) => [w, "throbbing"] as const),
  ...["stiff", "stiffness", "rigidez", "rigido", "rigida"].map((w) => [w, "stiffness"] as const),
  ...["tingling", "tingly", "formigueiro", "formigamento"].map((w) => [w, "tingling"] as const),
]);

type PainPart = { id: string } | { left: string; right: string };
const single = (id: string): PainPart => ({ id });
const sided = (base: string): PainPart => ({ left: `${base}_left`, right: `${base}_right` });

/**
 * Body parts, folded, in English and pt-PT, without filler words ("back of
 * thigh" is read as "back thigh"). Front or back follows where the part is
 * usually felt; the preview names the region before anything is saved.
 */
const PAIN_PARTS: ReadonlyMap<string, PainPart> = new Map(
  (
    [
      [["neck", "pescoco", "cervical"], single("joint.neck")],
      [["jaw", "maxilar", "mandibula"], sided("joint.jaw")],
      [["elbow", "cotovelo"], sided("joint.elbow")],
      [["wrist", "hand", "wrist and hand", "pulso", "punho", "mao"], sided("joint.wrist_hand")],
      [["hip", "anca"], sided("joint.hip")],
      [["knee", "joelho"], sided("joint.knee")],
      [["ankle", "foot", "ankle and foot", "tornozelo", "pe"], sided("joint.ankle_foot")],
      [["head", "cabeca"], single("front.head")],
      [["shoulder", "ombro"], sided("front.shoulder")],
      [["chest", "peito"], sided("front.chest")],
      [["upper arm", "arm", "biceps", "braco"], sided("front.biceps")],
      [["forearm", "antebraco"], sided("front.forearm")],
      [["abdomen", "abs", "barriga", "abdominal"], sided("front.abs")],
      [["thigh", "quad", "quadriceps", "coxa"], sided("front.thigh")],
      [["shin", "lower leg", "canela"], sided("front.shin")],
      [["traps", "trapezius", "trapezio"], single("back.traps")],
      [["upper back", "parte superior costas"], sided("back.upper_back")],
      [
        ["lower back", "low back", "back", "lombar", "zona lombar", "fundo costas", "costas"],
        sided("back.lower_back"),
      ],
      [["triceps"], sided("back.triceps")],
      [["glute", "buttock", "gluteo", "nadega"], sided("back.glutes")],
      [["hamstring", "back thigh", "posterior coxa", "isquiotibial"], sided("back.hamstrings")],
      [["calf", "calves", "gemeo", "barriga perna"], sided("back.calf")],
    ] as const
  ).flatMap(([words, part]) => words.map((word) => [word, part] as const)),
);

function painPartOf(phrase: string): PainPart | null {
  const exact = PAIN_PARTS.get(phrase);
  if (exact) return exact;
  // "knees", "joelhos", "ombros": the last word in the plural.
  return phrase.endsWith("s") ? (PAIN_PARTS.get(phrase.slice(0, -1)) ?? null) : null;
}

type PainLine = { regions: string[]; rating: string; type: PainType | null };

/**
 * "pain left knee 4", "dor joelho esquerdo 4", "sharp pain right shoulder
 * 6/10", "dor de cabeça 3": the region (both sides when no side is named),
 * the rating as typed and an optional type. Null without a pain word, or
 * with words that name no body part.
 */
function readPain(folded: string): PainLine | null {
  const text = ` ${folded} `
    .replace(/(\d)\s*\/\s*10(?=\s)/g, "$1")
    .replace(/(\d)\s+(?:out of|of|de|em)\s+10(?=\s)/g, "$1")
    .replace(/\spins and needles(?=\s)/g, " tingling");
  const words = wordsOf(text);
  if (!words.some((word) => PAIN_WORDS.has(word))) return null;
  let rating = "";
  let type: PainType | null = null;
  let side: "left" | "right" | null = null;
  const part: string[] = [];
  for (const word of words) {
    if (PAIN_WORDS.has(word) || PAIN_FILLER.has(word)) continue;
    if (NUMBER.test(word)) {
      if (rating) return null;
      rating = word;
      continue;
    }
    const named = PAIN_TYPE_WORDS.get(word);
    if (named) {
      if (type && type !== named) return null;
      type = named;
      continue;
    }
    const sideWord = PAIN_SIDES.get(word);
    if (sideWord) {
      if (side && side !== sideWord) return null;
      side = sideWord;
      continue;
    }
    part.push(word);
  }
  if (part.length === 0) return { regions: [], rating, type };
  const found = painPartOf(part.join(" "));
  if (!found) return null;
  if ("id" in found) return { regions: [found.id], rating, type };
  return { regions: side ? [found[side]] : [found.left, found.right], rating, type };
}

/** Everything but workouts and food, after the time words are taken out. */
function parseRest(
  time: TimeWords,
  context: OneLinerContext,
  now: Date,
): Exclude<OneLiner, { type: "workout" } | { type: "food" }> | null {
  const kindOf = (id: string) => context.kinds.find((kind) => kind.id === id);
  const at = observedAtOf(time, now);
  const withTime = (values: Record<string, string>) =>
    at ? { ...values, observedAt: at } : values;
  const rest = time.rest;
  if (!rest) return null;

  // The member's own trackers first: their names are the most specific words.
  const loggable = context.trackers.filter((tracker) => kindOf(trackerLogKindId(tracker.id)));
  const tracked = matchTrackerOneLiner(rest, loggable, context.locale);
  if (tracked) {
    const kind = kindOf(trackerLogKindId(tracked.tracker.id))!;
    const value = rest.slice(tracked.tracker.name.trim().length).trim();
    return { type: "entry", entry: { kind, values: withTime({ value }), at } };
  }

  const folded = fold(rest);

  const sleepKind = kindOf("sleep");
  const sleep = SLEEP_WORDS.exec(folded);
  if (sleep && sleepKind) {
    const entry = parseSleep(sleep[1]!, time, sleepKind, context, now);
    return entry ? { type: "entry", entry } : null;
  }

  const pressureKind = kindOf("blood_pressure");
  const pressure = BLOOD_PRESSURE.exec(folded);
  if (pressure && pressureKind)
    return {
      type: "entry",
      entry: {
        kind: pressureKind,
        values: withTime({
          systolic: pressure[1]!,
          diastolic: pressure[2]!,
          pulse: pressure[3] ?? "",
        }),
        at,
      },
    };

  const supplementKind = kindOf("supplement_intake");
  const took = SUPPLEMENT_WORDS.exec(folded);
  if (took && supplementKind) {
    const supplement = findSupplement(took[1]!.trim(), context.supplements);
    return {
      type: "entry",
      entry: {
        kind: supplementKind,
        values: withTime(supplement ? { supplement: String(supplement.id) } : {}),
        at,
      },
    };
  }

  // Pain (#442), only when the member turned the pain log on.
  const painKind = kindOf("pain");
  const pain = painKind ? readPain(folded) : null;
  if (pain && painKind) {
    const entryFor = (region: string): OneLinerEntry => ({
      kind: painKind,
      values: withTime({ region, rating: pain.rating, type: pain.type ?? "" }),
      at,
    });
    // "pain knee 4": the same rating for the left or the right knee.
    if (pain.regions.length === 2 && pain.rating)
      return { type: "choices", number: pain.rating, entries: pain.regions.map(entryFor) };
    return { type: "entry", entry: entryFor(pain.regions.length === 1 ? pain.regions[0]! : "") };
  }

  // Drink presets (#443), only those the server can log now.
  const drink = readDrink(folded);
  const drinkKind = drink ? kindOf(drinkLogKindId(drink.key)) : undefined;
  if (drink && drinkKind)
    return {
      type: "entry",
      entry: {
        kind: drinkKind,
        values: withTime({ volume: drink.volume, [unitKey("volume")]: drink.unit }),
        at,
      },
    };

  // One number with a kind word and/or a unit: "500 ml", "water 500", "hr 62", "82,4 kg".
  const tokens = folded
    .replace(/(\d)([a-z])/g, "$1 $2")
    .replace(/([a-z])(\d)/g, "$1 $2")
    .split(" ");
  const numbers = tokens.flatMap((token, index) => (NUMBER.test(token) ? [index] : []));
  if (numbers.length !== 1) return null;
  const index = numbers[0]!;
  const raw = tokens[index]!;
  const before = tokens.slice(0, index).join(" ");
  const after = tokens.slice(index + 1).join(" ");
  const unit =
    UNIT_WORDS.find(({ word }) => after === word || after.startsWith(`${word} `)) ?? null;
  const afterWord = unit ? after.slice(unit.word.length).trim() : after;
  const wordBefore = before ? keywordOf(before) : null;
  const wordAfter = afterWord ? keywordOf(afterWord) : null;
  if ((before && !wordBefore) || (afterWord && !wordAfter)) return null;
  if (wordBefore && wordAfter && wordBefore !== wordAfter) return null;
  const word = wordBefore ?? wordAfter;

  if (!word && !unit) {
    // A bare number is never saved directly: offer the kinds it could be.
    const candidates: OneLinerEntry[] = [];
    for (const kind of context.kinds) {
      const shape = trackerShapeOfLogKind(kind);
      const single =
        (BARE_NUMBER_KINDS as readonly string[]).includes(kind.id) ||
        shape?.type === "number" ||
        shape?.type === "scale";
      if (!single || !hasQuickForm(kind)) continue;
      const values = numberValues(kind, raw, null, context);
      if (!values) continue;
      const entry = { kind, values: withTime(values), at };
      if (validates(entry, context, now)) candidates.push(entry);
    }
    const counts = context.kindCounts ?? {};
    const ranked = candidates
      .map((entry, order) => ({ entry, order, count: counts[entry.kind.id] ?? 0 }))
      .sort((a, b) => b.count - a.count || a.order - b.order)
      .slice(0, MAX_CHOICES)
      .map(({ entry }) => entry);
    return ranked.length > 0 ? { type: "choices", number: raw, entries: ranked } : null;
  }

  const kindId = word ?? unit!.kind;
  if (
    unit &&
    word &&
    unit.kind !== word &&
    !(unit.kind === "heart_rate" && word === "resting_heart_rate")
  )
    return null;
  const kind = kindOf(kindId);
  if (!kind) return null;
  const values = numberValues(kind, raw, unit, context);
  return values ? { type: "entry", entry: { kind, values: withTime(values), at } } : null;
}

/**
 * Reads what the member typed. Null for blank text, or for text with no
 * letters that fits nothing (it is not food either).
 */
export function parseOneLiner(text: string, context: OneLinerContext): OneLiner | null {
  const input = text.trim().replace(/\s+/g, " ");
  if (!input) return null;
  const now = context.now ?? new Date();

  const first = extractTime(input, false);
  const parsed = parseRest(first, context, now);
  if (parsed) return parsed;
  const second = extractTime(input, true);
  if (second.rest !== first.rest) {
    const retry = parseRest(second, context, now);
    if (retry) return retry;
  }

  const firstWord = fold(input).split(" ")[0] ?? "";
  if (WORKOUT_WORDS.has(firstWord) && context.kinds.some((kind) => kind.id === "workout"))
    return { type: "workout", text: input };
  if (/\p{L}/u.test(input) && context.kinds.some((kind) => kind.id === "food"))
    return { type: "food", text: input, drafts: context.foodDrafts === true };
  return null;
}

// ─── Preview ─────────────────────────────────────────────────────

export type OneLinerPreview = {
  /** "Water", "Supplement taken", or the tracker's own name. */
  title: string;
  /** "500 ml", "Magnesium · 200 mg"; "check the value" when it does not fit. */
  value: string;
  /** "now", "today, 08:00", "yesterday, 22:00"; null for sleep (its value has the times). */
  time: string | null;
  /** The write Enter makes; null opens the quick form with the values filled in. */
  write: QuickLogWrite | null;
};

export type OneLinerPreviewContext = {
  timeZone: string;
  newId: () => string;
  locale?: string;
  now?: Date;
  weightUnit?: "kg" | "lb";
  supplements: readonly OneLinerSupplement[];
};

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "now", "today, 08:00", "yesterday, 22:00", or a short date and time. */
export function oneLinerTimeLabel(at: string | null, i18n: I18n, now: Date = new Date()): string {
  if (at === null) return i18n._(ONE_LINER_COPY.now);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(at);
  if (!match) return at;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi);
  const locale = i18n.locale || "en";
  const time = new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
  if (sameDay(date, now)) return i18n._({ ...ONE_LINER_COPY.today, values: { time } });
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return i18n._({ ...ONE_LINER_COPY.yesterday, values: { time } });
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** What the palette shows before Enter: "Water · 500 ml · now". */
export function previewOneLinerEntry(
  entry: OneLinerEntry,
  i18n: I18n,
  context: OneLinerPreviewContext,
): OneLinerPreview {
  const now = context.now ?? new Date();
  const supplement =
    entry.kind.id === "supplement_intake"
      ? context.supplements.find((item) => String(item.id) === entry.values.supplement)
      : undefined;
  const parsed = buildQuickLogWrite(entry.kind, entry.values, {
    timeZone: context.timeZone,
    newId: context.newId,
    locale: context.locale,
    now,
    supplementDose: (id) => context.supplements.find((item) => item.id === id)?.dose ?? null,
  });
  const write = parsed.ok ? parsed.write : null;
  const amount = write
    ? quickLogWriteValue(write, entry.kind, i18n, { weightUnit: context.weightUnit })
    : null;
  const value = supplement
    ? [supplement.name, amount].filter(Boolean).join(" · ")
    : (amount ?? i18n._(ONE_LINER_COPY.checkValue));
  const timed = entry.kind.fields.some((field) => field.id === "observedAt");
  return {
    title: i18n._(entry.kind.label),
    value,
    time: timed ? oneLinerTimeLabel(entry.at, i18n, now) : null,
    write,
  };
}
