/**
 * Issue #96 — versioned reference data for reference comparisons. Pure data
 * (no imports) so web and native bundle the same tables the server uses.
 *
 * Every dataset records where it comes from (source, URL, publisher, year),
 * who was measured (population, collection years), how (method) and under
 * what terms it may be shipped (licence), plus the date the values were
 * checked against the source. `reference-data.test.ts` fails the build when a
 * dataset lacks any of these. Values are copied from the cited primary source
 * only; nothing here is estimated, interpolated or derived. Sources that were
 * considered but are not shipped are listed in {@link REFERENCES_NOT_SHIPPED}
 * and in `docs/reference-comparisons.md`.
 *
 * Changing any value, row or dataset bumps {@link REFERENCE_DATA_VERSION}.
 */

export const REFERENCE_DATA_VERSION = "reference-data-2026-10-16";

export type ReferenceSource = {
  /** Full citation, as shown to people. */
  citation: string;
  /** Short label for compact UI, e.g. "NCHS, NHANES 1999–2008". */
  shortLabel: string;
  url: string;
  publisher: string;
  /** Publication year (or edition year). */
  year: number;
};

export type ReferenceMetadata = {
  id: string;
  /** Version of this dataset's content (source edition). */
  version: string;
  source: ReferenceSource;
  /** Who the values describe. */
  population: string;
  /** Years the underlying data were collected, or the year the guidance was issued. */
  collectionYears: string;
  /** How the values were measured or decided. */
  method: string;
  /** Terms under which the values are reproduced here. */
  licence: string;
  /** Date (YYYY-MM-DD) the shipped values were checked against the source. */
  checkedOn: string;
};

/** Age rows: `maxAge` null means "and over". Ages are whole years. */
export type AgeSpan = { minAge: number; maxAge: number | null };

/** A recommended range published by a guideline body. */
export type GuidelineDataset = ReferenceMetadata & {
  kind: "guideline";
  unit: "minutes_per_night" | "active_minutes_per_week";
  rows: readonly (AgeSpan & { lower: number; upper: number })[];
};

/**
 * Descriptive distribution of measured values in a reference population.
 * Only the quartiles are shipped: comparisons use three coarse bands (below,
 * within, above the middle half), never a rank.
 */
export type DistributionDataset = ReferenceMetadata & {
  kind: "distribution";
  unit: "bpm";
  rows: readonly (AgeSpan & {
    sex: "female" | "male";
    /** Participants in this row. */
    n: number;
    lowerQuartile: number;
    median: number;
    upperQuartile: number;
  })[];
};

export type ReferenceDataset = GuidelineDataset | DistributionDataset;

/** WHO 2020: 150–300 minutes of moderate-intensity (or equivalent) activity a week. */
export const WHO_2020_PHYSICAL_ACTIVITY: GuidelineDataset = {
  id: "who-2020-physical-activity",
  version: "2020",
  kind: "guideline",
  source: {
    citation:
      "Bull FC, et al. World Health Organization 2020 guidelines on physical activity and sedentary behaviour. Br J Sports Med. 2020;54:1451–1462.",
    shortLabel: "WHO guidelines, 2020",
    url: "https://doi.org/10.1136/bjsports-2020-102955",
    publisher: "World Health Organization",
    year: 2020,
  },
  population: "Adults aged 18 and over, including older adults (65+).",
  collectionYears: "Guidance issued 2020",
  method:
    "Expert guideline development group reviewing systematic evidence. Vigorous minutes count double (moderate-equivalent).",
  licence:
    "Only the two published figures are used, as facts, with attribution; no WHO text, table or figure is reproduced.",
  checkedOn: "2026-10-16",
  unit: "active_minutes_per_week",
  rows: [{ minAge: 18, maxAge: null, lower: 150, upper: 300 }],
};

/** National Sleep Foundation 2015: 7–9 h for adults 18–64, 7–8 h for 65+. */
export const NSF_2015_SLEEP_DURATION: GuidelineDataset = {
  id: "nsf-2015-sleep-duration",
  version: "2015",
  kind: "guideline",
  source: {
    citation:
      "Hirshkowitz M, et al. National Sleep Foundation's sleep time duration recommendations: methodology and results summary. Sleep Health. 2015;1(1):40–43.",
    shortLabel: "National Sleep Foundation, 2015",
    url: "https://doi.org/10.1016/j.sleh.2014.12.010",
    publisher: "National Sleep Foundation",
    year: 2015,
  },
  population: "Adults without a sleep disorder: adults 18–64 and adults 65 and over.",
  collectionYears: "Recommendations issued 2015",
  method:
    "18-member multidisciplinary expert panel using the RAND/UCLA Appropriateness Method. A recommended range, not a measured distribution.",
  licence:
    "Published recommendation figures quoted with attribution (facts, not the article text).",
  checkedOn: "2026-10-16",
  unit: "minutes_per_night",
  rows: [
    { minAge: 18, maxAge: 64, lower: 7 * 60, upper: 9 * 60 },
    { minAge: 65, maxAge: null, lower: 7 * 60, upper: 8 * 60 },
  ],
};

/**
 * NCHS National Health Statistics Report No. 41, Tables 2 (males) and 3
 * (females): resting pulse rate, normative sample (people without a condition
 * or medication affecting pulse), adult age groups.
 */
export const NCHS_NHSR41_RESTING_PULSE: DistributionDataset = {
  id: "nchs-nhsr41-resting-pulse",
  version: "nhsr-41",
  kind: "distribution",
  source: {
    citation:
      "Ostchega Y, Porter KS, Hughes J, Dillon CF, Nwankwo T. Resting pulse rate reference data for children, adolescents, and adults: United States, 1999–2008. National Health Statistics Reports No. 41. Hyattsville, MD: National Center for Health Statistics; 2011. Tables 2 and 3.",
    shortLabel: "NCHS, NHANES 1999–2008",
    url: "https://www.cdc.gov/nchs/data/nhsr/nhsr041.pdf",
    publisher: "National Center for Health Statistics (CDC)",
    year: 2011,
  },
  population:
    "US civilian, non-institutionalised adults (NHANES), excluding pregnancy, likely infection, irregular pulse, out-of-range thyroid tests and medications that affect heart rate. Weighted to the US population.",
  collectionYears: "1999–2008",
  method:
    "Radial pulse counted by a physician for 30 seconds (×2) after about 4 minutes of seated quiet rest, in a mobile examination centre.",
  licence:
    "US federal government work in the public domain (NHANES material may be reproduced without permission; citation requested).",
  checkedOn: "2026-10-16",
  unit: "bpm",
  rows: [
    {
      sex: "male",
      minAge: 20,
      maxAge: 39,
      n: 3445,
      lowerQuartile: 61,
      median: 69,
      upperQuartile: 76,
    },
    {
      sex: "male",
      minAge: 40,
      maxAge: 59,
      n: 2559,
      lowerQuartile: 61,
      median: 68,
      upperQuartile: 77,
    },
    {
      sex: "male",
      minAge: 60,
      maxAge: 79,
      n: 1147,
      lowerQuartile: 60,
      median: 67,
      upperQuartile: 75,
    },
    {
      sex: "male",
      minAge: 80,
      maxAge: null,
      n: 197,
      lowerQuartile: 61,
      median: 68,
      upperQuartile: 78,
    },
    {
      sex: "female",
      minAge: 20,
      maxAge: 39,
      n: 3061,
      lowerQuartile: 66,
      median: 74,
      upperQuartile: 82,
    },
    {
      sex: "female",
      minAge: 40,
      maxAge: 59,
      n: 2409,
      lowerQuartile: 64,
      median: 71,
      upperQuartile: 79,
    },
    {
      sex: "female",
      minAge: 60,
      maxAge: 79,
      n: 1163,
      lowerQuartile: 64,
      median: 70,
      upperQuartile: 78,
    },
    {
      sex: "female",
      minAge: 80,
      maxAge: null,
      n: 219,
      lowerQuartile: 64,
      median: 71,
      upperQuartile: 77,
    },
  ],
};

export const REFERENCE_DATASETS: readonly ReferenceDataset[] = [
  WHO_2020_PHYSICAL_ACTIVITY,
  NSF_2015_SLEEP_DURATION,
  NCHS_NHSR41_RESTING_PULSE,
];

/**
 * References considered for #96 and deliberately not shipped, with the reason.
 * Each needs a human decision (licence, verification or a comparable input)
 * before it can become a dataset above.
 */
export const REFERENCES_NOT_SHIPPED: readonly {
  topic: string;
  source: string;
  url: string;
  reason: string;
}[] = [
  {
    topic: "Steps per day",
    source: "Tudor-Locke C, et al. Med Sci Sports Exerc. 2009 (NHANES 2005–2006 hip-worn monitor)",
    url: "https://doi.org/10.1249/MSS.0b013e318199885c",
    reason:
      "Hip-worn reference; wrist and phone counts are not comparable, and the tables are journal-copyrighted. Not verified or licensed.",
  },
  {
    topic: "VO₂max",
    source: "Kaminsky LA, et al. FRIEND registry. Mayo Clin Proc. 2022",
    url: "https://doi.org/10.1016/j.mayocp.2021.08.020",
    reason:
      "Journal-copyrighted lab-test registry (link only). OpenValens does not record VO₂max yet.",
  },
  {
    topic: "Grip strength",
    source: "Dodds RM, et al. PLoS One. 2014 (UK) / Wang YC, et al. JOSPT. 2018 (NHANES)",
    url: "https://doi.org/10.1371/journal.pone.0113637",
    reason: "Licence not confirmed. OpenValens does not record grip strength yet.",
  },
  {
    topic: "Heart rate variability",
    source: "Nunan D, et al. Pacing Clin Electrophysiol. 2010",
    url: "https://doi.org/10.1111/j.1540-8159.2010.02841.x",
    reason:
      "A range from short supine ECG recordings, not an age×sex table; not comparable with overnight wearable HRV.",
  },
];
