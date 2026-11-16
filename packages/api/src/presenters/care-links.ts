/**
 * Care links shared by web and mobile (clinical#7, preventive-care#8; owner
 * decision 2026-11-16, see "Legal and clinical gate decisions" item 9).
 *
 * Two plain synonym tables, matched on the person's own words:
 * - a family history condition ("Type 2 diabetes") links to the related lab
 *   markers, the vitals screen and the preventive-care page;
 * - a logged supplement ("Vitamin D3") pins the matching evidence-check card.
 *
 * A link is navigation only. It never changes which preventive-care items
 * are listed, when they are due, or what a lab result means, and it never
 * names a risk. Matching ignores case, accents and punctuation and looks for
 * whole words, so "Vitamin D-3" matches "vitamin d" and "brcancer" matches
 * nothing. Pure (no I/O), safe for the app bundles.
 */
import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

/** Lower case, accents and punctuation dropped, single spaces: "Hipertensão!" → "hipertensao". */
export function normalizeCareText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** True when `phrase` appears in `text` as whole words (both already normalized). */
function hasPhrase(text: string, phrase: string): boolean {
  return ` ${text} `.includes(` ${phrase} `);
}

function matchesAny(text: string, phrases: readonly string[]): boolean {
  const normalized = normalizeCareText(text);
  return normalized.length > 0 && phrases.some((phrase) => hasPhrase(normalized, phrase));
}

// ─── family history → labs, vitals, preventive care ───────────

/**
 * Where a link goes: one lab marker's row, the vitals screen, or preventive
 * care. A preventive link names the item topics it stands for (the part of a
 * preventive item id after `<region>.`); it is shown only when the person's
 * region has one of them.
 */
export type CareLinkTarget =
  | { kind: "lab"; code: string }
  | { kind: "vitals" }
  | { kind: "preventive"; topics: readonly string[] };

export type CareLink = { key: string; target: CareLinkTarget; label: MessageDescriptor };

const lab = (marker: string, label: MessageDescriptor): CareLink => ({
  key: `lab:${marker}`,
  target: { kind: "lab", code: `blood_marker_${marker}` },
  label,
});
const preventive = (
  key: string,
  topics: readonly string[],
  label: MessageDescriptor,
): CareLink => ({
  key: `preventive:${key}`,
  target: { kind: "preventive", topics },
  label,
});

/**
 * Whether a preventive link has an item in the person's region. `itemIds` are
 * the region's preventive item ids (`us.breast_screening`, …), whether or not
 * they match the person's age and sex; a topic ending in `*` matches by prefix.
 */
export function preventiveLinkAvailable(
  target: Extract<CareLinkTarget, { kind: "preventive" }>,
  itemIds: readonly string[],
): boolean {
  const topics = itemIds.map((id) => id.slice(id.indexOf(".") + 1));
  return target.topics.some((wanted) =>
    wanted.endsWith("*")
      ? topics.some((topic) => topic.startsWith(wanted.slice(0, -1)))
      : topics.includes(wanted),
  );
}

const LINKS = {
  hba1c: lab("hba1c", msg`HbA1c`),
  glucose: lab("glucose", msg`Glucose`),
  totalCholesterol: lab("total_cholesterol", msg`Total cholesterol`),
  ldl: lab("ldl", msg`LDL cholesterol`),
  tsh: lab("tsh", msg`TSH`),
  creatinine: lab("creatinine", msg`Creatinine`),
  bloodPressure: {
    key: "vitals:blood_pressure",
    target: { kind: "vitals" },
    label: msg`Blood pressure readings`,
  } satisfies CareLink,
  bloodPressureScreening: preventive(
    "blood_pressure",
    ["blood_pressure_screening"],
    msg`Blood pressure screening`,
  ),
  bowelScreening: preventive(
    "bowel",
    ["bowel_screening", "colorectal_screening*"],
    msg`Bowel cancer screening`,
  ),
  breastScreening: preventive("breast", ["breast_screening"], msg`Breast screening`),
  cervicalScreening: preventive("cervical", ["cervical_screening"], msg`Cervical screening`),
  lungScreening: preventive("lung", ["lung_screening", "lung_health_check"], msg`Lung screening`),
  prostateTesting: preventive("prostate", ["prostate_psa*"], msg`Prostate (PSA) testing`),
  boneScreening: preventive("bone", ["osteoporosis_screening"], msg`Bone density screening`),
  aaaScreening: preventive("aaa", ["aaa_screening"], msg`Aortic aneurysm screening`),
} as const;

/**
 * The synonym table. Phrases are normalized (lower case, no accents) and in
 * English and Portuguese, the app's two languages. Order sets link order.
 */
export const FAMILY_HISTORY_TOPICS: ReadonlyArray<{
  id: string;
  phrases: readonly string[];
  links: readonly CareLink[];
}> = [
  {
    id: "diabetes",
    phrases: ["diabetes", "diabetic", "t2d", "t2dm", "prediabetes", "diabetica", "diabetico"],
    links: [LINKS.hba1c, LINKS.glucose],
  },
  {
    id: "blood_pressure",
    phrases: [
      "high blood pressure",
      "hypertension",
      "hipertensao",
      "tensao alta",
      "pressao alta",
      "hipertensao arterial",
    ],
    links: [LINKS.bloodPressure, LINKS.bloodPressureScreening],
  },
  {
    id: "cholesterol",
    phrases: [
      "cholesterol",
      "hypercholesterolemia",
      "hypercholesterolaemia",
      "dyslipidemia",
      "dyslipidaemia",
      "colesterol",
      "hipercolesterolemia",
      "dislipidemia",
    ],
    links: [LINKS.totalCholesterol, LINKS.ldl],
  },
  {
    id: "heart",
    phrases: [
      "heart disease",
      "heart attack",
      "coronary",
      "myocardial infarction",
      "stroke",
      "cardiovascular",
      "doenca cardiaca",
      "enfarte",
      "infarto",
      "avc",
    ],
    links: [LINKS.ldl, LINKS.bloodPressure, LINKS.bloodPressureScreening],
  },
  {
    id: "bowel",
    phrases: [
      "colorectal",
      "colon cancer",
      "bowel cancer",
      "rectal cancer",
      "colorretal",
      "cancro do colon",
      "cancro do intestino",
    ],
    links: [LINKS.bowelScreening],
  },
  {
    id: "breast",
    phrases: ["breast cancer", "brca", "brca1", "brca2", "cancro da mama", "cancro de mama"],
    links: [LINKS.breastScreening],
  },
  {
    id: "cervical",
    phrases: ["cervical cancer", "cancro do colo do utero"],
    links: [LINKS.cervicalScreening],
  },
  {
    id: "lung",
    phrases: ["lung cancer", "cancro do pulmao"],
    links: [LINKS.lungScreening],
  },
  {
    id: "prostate",
    phrases: ["prostate cancer", "cancro da prostata"],
    links: [LINKS.prostateTesting],
  },
  {
    id: "bone",
    phrases: ["osteoporosis", "osteoporose", "hip fracture", "fratura da anca"],
    links: [LINKS.boneScreening],
  },
  {
    id: "aaa",
    phrases: ["aortic aneurysm", "aneurysm", "aneurisma"],
    links: [LINKS.aaaScreening],
  },
  {
    id: "thyroid",
    phrases: [
      "thyroid",
      "hypothyroidism",
      "hyperthyroidism",
      "hashimoto",
      "graves",
      "tiroide",
      "tireoide",
      "hipotiroidismo",
      "hipertiroidismo",
    ],
    links: [LINKS.tsh],
  },
  {
    id: "kidney",
    phrases: ["kidney disease", "renal", "ckd", "doenca renal", "insuficiencia renal"],
    links: [LINKS.creatinine],
  },
];

/** The links for one family history condition, in table order, each once. */
export function familyHistoryCareLinks(condition: string): CareLink[] {
  const seen = new Set<string>();
  const links: CareLink[] = [];
  for (const topic of FAMILY_HISTORY_TOPICS) {
    if (!matchesAny(condition, topic.phrases)) continue;
    for (const link of topic.links) {
      if (seen.has(link.key)) continue;
      seen.add(link.key);
      links.push(link);
    }
  }
  return links;
}

export const CARE_LINK_COPY = {
  relevantTo: msg`Relevant to:`,
  /** The ⓘ beside "Relevant to:", in plain words. */
  familyInfo: msg({
    message:
      "These links appear because the condition you wrote matches a short list of names. They take you to your own records and to the public guidance you already see. They do not change which screenings are listed for you or when, and they say nothing about your own health.",
    comment: "safety",
  }),
} as const;

export type CareLinkView = { key: string; target: CareLinkTarget; label: string };

export type FamilyCareLinksView = {
  /** "Relevant to: HbA1c and Glucose", for screen readers and plain-text surfaces. */
  text: string;
  links: CareLinkView[];
};

/** "A", "A and B", "A, B and C". */
export function joinCareLabels(labels: readonly string[], i18n: I18n): string {
  if (labels.length <= 1) return labels.join("");
  const first = labels.slice(0, -1).join(", ");
  const last = labels.at(-1) ?? "";
  return i18n._(msg`${first} and ${last}`);
}

/**
 * The "Relevant to:" line for a family history card, or null when nothing
 * matches. `preventiveItemIds` are the person's region's preventive items
 * (shown and not shown); a screening link appears only when one of them
 * matches, and never while they are unknown (no region, care module off,
 * still loading). Lab and vitals links always show.
 */
export function familyCareLinksView(
  condition: string,
  i18n: I18n,
  preventiveItemIds: readonly string[] = [],
): FamilyCareLinksView | null {
  const links = familyHistoryCareLinks(condition).filter(
    (link) =>
      link.target.kind !== "preventive" || preventiveLinkAvailable(link.target, preventiveItemIds),
  );
  if (links.length === 0) return null;
  const views = links.map((link) => ({
    key: link.key,
    target: link.target,
    label: i18n._(link.label),
  }));
  const list = joinCareLabels(
    views.map((view) => view.label),
    i18n,
  );
  return { text: `${i18n._(CARE_LINK_COPY.relevantTo)} ${list}`, links: views };
}

// ─── logged supplements → evidence-check cards ────────────────

/**
 * Evidence-check entry id → supplement names that mean it. Ids are the
 * library's own (`evidence-check-library.ts`); a renamed entry simply stops
 * matching.
 */
export const SUPPLEMENT_EVIDENCE_SYNONYMS: Readonly<Record<string, readonly string[]>> = {
  vitamin_d_supplements: [
    "vitamin d",
    "vitamin d3",
    "vitamin d2",
    "vit d",
    "d3",
    "cholecalciferol",
    "vitamina d",
    "vitamina d3",
    "colecalciferol",
  ],
  omega_3_supplements: [
    "omega 3",
    "omega3",
    "fish oil",
    "cod liver oil",
    "krill oil",
    "epa",
    "dha",
    "oleo de peixe",
    "oleo de figado de bacalhau",
    "omega 3s",
  ],
  multivitamins: ["multivitamin", "multivitamins", "multi vitamin", "multivitaminico"],
  beta_carotene_vitamin_e: [
    "beta carotene",
    "betacarotene",
    "vitamin e",
    "betacaroteno",
    "vitamina e",
  ],
  creatine: ["creatine", "creatina"],
  magnesium_sleep: ["magnesium", "magnesio"],
};

/** The evidence entries a supplement name matches (usually none or one). */
export function evidenceEntriesForSupplement(name: string): string[] {
  return Object.entries(SUPPLEMENT_EVIDENCE_SYNONYMS)
    .filter(([, phrases]) => matchesAny(name, phrases))
    .map(([entryId]) => entryId);
}

export type LoggedSupplementLike = { id: number; name: string };

export type PinnedEvidence<T> = {
  entry: T;
  /** The person's own supplement this card matched, or null for an unpinned card. */
  supplement: LoggedSupplementLike | null;
};

/**
 * The library with the cards for the person's logged supplements first, in
 * the library's own order, each with the supplement it matched (the first
 * one, by the order given). The rest keep their order.
 */
export function pinEvidenceEntries<T extends { id: string }>(
  entries: readonly T[],
  supplements: readonly LoggedSupplementLike[],
): PinnedEvidence<T>[] {
  const match = new Map<string, LoggedSupplementLike>();
  for (const supplement of supplements) {
    for (const entryId of evidenceEntriesForSupplement(supplement.name)) {
      if (!match.has(entryId)) match.set(entryId, supplement);
    }
  }
  const pinned: PinnedEvidence<T>[] = [];
  const rest: PinnedEvidence<T>[] = [];
  for (const entry of entries) {
    const supplement = match.get(entry.id) ?? null;
    (supplement ? pinned : rest).push({ entry, supplement });
  }
  return [...pinned, ...rest];
}

/** "You log Vitamin D3", the pinned card's line, with the person's own name for it. */
export function loggedSupplementText(supplement: LoggedSupplementLike, i18n: I18n): string {
  const name = supplement.name.trim();
  return i18n._(msg`You log ${name}`);
}

export const PINNED_EVIDENCE_COPY = {
  info: msg`Cards for supplements you log come first. They are matched by name, so a brand name may not match.`,
  openSupplement: msg`Open in Supplements`,
} as const;
