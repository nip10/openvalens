/**
 * Food drafts from a spoken or typed description (Issue #73). Pure and
 * dependency-free, so the web and native apps can run it on the device.
 *
 * A draft is a list of candidate items, each with the words that named the
 * food and, when stated, a quantity and unit. Nothing here looks up a food,
 * estimates a portion or produces a nutrient value: every candidate stays
 * unresolved until the member picks a food with verified provenance (or a
 * custom food) and confirms the entry. Anything unclear is flagged rather
 * than guessed.
 */

export const FOOD_DRAFT_LIMITS = Object.freeze({
  maxTranscriptChars: 2_000,
  maxCandidates: 20,
  maxFoodTextChars: 200,
});

/** Why a candidate needs the member's attention before it can be logged. */
/** `unsure_food` comes only from a photo draft whose item could not be identified clearly. */
export const FOOD_DRAFT_FLAGS = [
  "no_quantity",
  "vague_quantity",
  "no_unit",
  "unsure_food",
] as const;
export type FoodDraftFlag = (typeof FOOD_DRAFT_FLAGS)[number];

export type FoodDraftCandidate = {
  id: string;
  /** The words this candidate came from, as spoken. */
  sourceText: string;
  foodText: string;
  quantityText: string | null;
  /** A number only when the quantity was stated as one ("2", "two", "1/2", "half"). */
  quantity: number | null;
  unitText: string | null;
  flags: FoodDraftFlag[];
};

export type FoodDraftResult =
  | { status: "ready"; candidates: FoodDraftCandidate[] }
  | { status: "empty" | "unrecognized" | "too_long"; candidates: [] };

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  half: 0.5,
  quarter: 0.25,
  dozen: 12,
};
const VAGUE = new Set(["some", "few", "several", "bit", "little", "lots", "handful", "couple"]);
const UNITS = new Map<string, string>(
  Object.entries({
    g: "g",
    gram: "g",
    grams: "g",
    kg: "kg",
    kilo: "kg",
    kilos: "kg",
    ml: "ml",
    milliliter: "ml",
    milliliters: "ml",
    millilitre: "ml",
    millilitres: "ml",
    l: "l",
    liter: "l",
    liters: "l",
    litre: "l",
    litres: "l",
    oz: "oz",
    ounce: "oz",
    ounces: "oz",
    lb: "lb",
    lbs: "lb",
    pound: "lb",
    pounds: "lb",
    cup: "cup",
    cups: "cup",
    tbsp: "tbsp",
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    tsp: "tsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
    slice: "slice",
    slices: "slice",
    piece: "piece",
    pieces: "piece",
    bowl: "bowl",
    bowls: "bowl",
    glass: "glass",
    glasses: "glass",
    can: "can",
    cans: "can",
    bottle: "bottle",
    bottles: "bottle",
    serving: "serving",
    servings: "serving",
    portion: "portion",
    portions: "portion",
    scoop: "scoop",
    scoops: "scoop",
    handful: "handful",
    handfuls: "handful",
    bar: "bar",
    bars: "bar",
    packet: "packet",
    packets: "packet",
  }),
);
/** Words dropped between quantity/unit and the food ("a cup of rice"). */
const FILLER = new Set(["of", "the", "some", "my", "x"]);
const SEPARATORS = /\s*(?:[,;\n]|\band then\b|\bthen\b|\band\b|\bplus\b|\bwith\b|&)\s*/i;

function parseNumber(token: string): number | null {
  if (/^\d+(?:[.,]\d+)?$/.test(token)) return Number(token.replace(",", "."));
  const fraction = /^(\d+)\/(\d+)$/.exec(token);
  if (fraction && Number(fraction[2]) > 0) return Number(fraction[1]) / Number(fraction[2]);
  return NUMBER_WORDS[token] ?? null;
}

function parseSegment(segment: string, index: number): FoodDraftCandidate | null {
  const sourceText = segment.trim();
  // "200g" → "200 g"
  const tokens = sourceText
    .toLowerCase()
    .replace(/(\d)([a-z])/g, "$1 $2")
    .split(/\s+/)
    .filter(Boolean);
  let cursor = 0;
  let quantity: number | null = null;
  let quantityText: string | null = null;
  let vague = false;
  const first = tokens[cursor];
  if (first !== undefined) {
    const value = parseNumber(first);
    if (value !== null) {
      quantity = value;
      quantityText = first;
      cursor++;
      // "one and a half" never reaches here (split on "and"); "a half" does.
      const second = tokens[cursor];
      if (second !== undefined && (second === "half" || second === "quarter") && value === 1) {
        quantity = NUMBER_WORDS[second]!;
        quantityText = `${first} ${second}`;
        cursor++;
      }
    } else if (VAGUE.has(first) || (first === "a" && VAGUE.has(tokens[1] ?? ""))) {
      vague = true;
      quantityText = first === "a" ? `a ${tokens[1]}` : first;
      cursor += first === "a" ? 2 : 1;
    }
  }
  // "half a cup of berries"
  if (
    quantity !== null &&
    (tokens[cursor] === "a" || tokens[cursor] === "an") &&
    UNITS.has(tokens[cursor + 1] ?? "")
  )
    cursor++;
  let unitText: string | null = null;
  const unitToken = tokens[cursor];
  if (unitToken !== undefined && UNITS.has(unitToken) && cursor + 1 < tokens.length) {
    unitText = UNITS.get(unitToken)!;
    cursor++;
    if (unitText === "handful") vague = true;
  }
  while (cursor < tokens.length - 1 && FILLER.has(tokens[cursor]!)) cursor++;
  const foodText = tokens
    .slice(cursor)
    .join(" ")
    .replace(/[.!?]+$/, "")
    .slice(0, FOOD_DRAFT_LIMITS.maxFoodTextChars)
    .trim();
  if (!/[a-z]/.test(foodText)) return null;

  const flags: FoodDraftFlag[] = [];
  if (vague) flags.push("vague_quantity");
  else if (quantity === null) flags.push("no_quantity");
  if (unitText === null) flags.push("no_unit");
  return {
    id: `candidate-${index + 1}`,
    sourceText,
    foodText,
    quantityText,
    quantity: vague ? null : quantity,
    unitText,
    flags,
  };
}

/** Splits a description into unresolved food candidates. Never throws. */
export function parseFoodTranscript(transcript: string): FoodDraftResult {
  const text = typeof transcript === "string" ? transcript.trim() : "";
  if (!text) return { status: "empty", candidates: [] };
  if (text.length > FOOD_DRAFT_LIMITS.maxTranscriptChars)
    return { status: "too_long", candidates: [] };
  const candidates: FoodDraftCandidate[] = [];
  for (const segment of text.split(SEPARATORS)) {
    if (candidates.length >= FOOD_DRAFT_LIMITS.maxCandidates) break;
    if (!segment.trim()) continue;
    const candidate = parseSegment(segment, candidates.length);
    if (candidate) candidates.push(candidate);
  }
  return candidates.length
    ? { status: "ready", candidates }
    : { status: "unrecognized", candidates: [] };
}

/** Recomputes the flags after the member edits a candidate. */
export function foodDraftFlags(candidate: {
  quantity: number | null;
  unitText: string | null;
}): FoodDraftFlag[] {
  const flags: FoodDraftFlag[] = [];
  if (candidate.quantity === null) flags.push("no_quantity");
  if (!candidate.unitText) flags.push("no_unit");
  return flags;
}

/**
 * Builds a candidate from separately named parts (for example a provider's
 * structured reply). Quantities and units are normalized the same way as a
 * transcript; anything else stays as text and is flagged.
 */
export function candidateFromParts(
  parts: { food: string; quantity: string | null; unit: string | null; unsure?: boolean },
  index: number,
): FoodDraftCandidate | null {
  const foodText = parts.food
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, FOOD_DRAFT_LIMITS.maxFoodTextChars);
  if (!/[a-z]/i.test(foodText)) return null;
  const quantityText = parts.quantity?.trim().slice(0, 40) || null;
  const rawQuantity = quantityText?.toLowerCase() ?? null;
  const vague = rawQuantity !== null && rawQuantity.split(/\s+/).some((word) => VAGUE.has(word));
  const quantity = vague || rawQuantity === null ? null : parseNumber(rawQuantity);
  const rawUnit = parts.unit?.trim().toLowerCase() || null;
  const unitText = rawUnit === null ? null : (UNITS.get(rawUnit) ?? rawUnit.slice(0, 20));
  const flags: FoodDraftFlag[] = [];
  if (parts.unsure) flags.push("unsure_food");
  if (vague) flags.push("vague_quantity");
  else if (quantity === null) flags.push("no_quantity");
  if (unitText === null) flags.push("no_unit");
  return {
    id: `candidate-${index + 1}`,
    sourceText: [quantityText, unitText, foodText].filter(Boolean).join(" "),
    foodText,
    quantityText,
    quantity,
    unitText,
    flags,
  };
}
