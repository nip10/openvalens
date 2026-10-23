# Micronutrient summaries (#78)

An optional summary of eight vitamins and minerals from the foods a member
logs: calcium, iron, magnesium, potassium, zinc, vitamin C, vitamin D and
vitamin B12. It is general information from their own logs, not a diagnosis.

## Opt-in and visibility

- Off by default. The member turns on "Show a micronutrient summary" in
  nutrition settings (`micronutrientsEnabled`) and can turn it off at any time.
- Any self-declared exclusion (pregnancy or breastfeeding, an eating disorder,
  kidney disease and the others in `NUTRITION_EXCLUSIONS`) hides the summary
  entirely (`status: "hidden"`). Logging is not affected.
- Reference values are for adults only. Without a confirmed adult profile the
  amounts are shown without references (`referenceNote: "adults_only"`).
- Hide-numbers mode drops amounts, percentages and reference values, and
  keeps only how many foods reported each nutrient.

## Unknown is not zero

Food values come from the catalog (FDC, Open Food Facts) and are stored per
food and copied into the snapshot at logging time (part 1, PR #216). A food
that doesn't report a nutrient stores `NULL`. For each nutrient the summary
shows:

- **Coverage:** "2 of 3 foods reported this". This is always shown.
- **Amount:** the sum of the known values. If any food did not report the
  nutrient, it is shown as "at least" that amount.
- **Comparison:** a percentage of the intake reference (PRI, RDA or AI). It
  is shown only when every food that day reported the nutrient and the
  reference is a single number.

There are no low-intake or deficiency flags, and upper levels are shown as
numbers only. Custom and manual foods don't take micronutrient values yet, so
they count as unknown.

The summary is computed by `summarizeMicronutrients` in
`@openvalens/nutrition/micronutrient-summary`. The function is pure, and its
output carries the dataset version. It is re-exported through
`@openvalens/api/presenters/micronutrients`, so a device can summarize cached
entries with the same version and get identical values.

## Reference choice

The member chooses a source and a population group in nutrition settings.
Nothing is set until they save that choice. From the member's own profile
answers (region, sex, age range) the app may suggest:

- **Source:** US suggests NASEM; UK and Portugal suggest EFSA. Any other
  region gets no suggestion.
- **Population:** a group is suggested only when the age range fits one band.

The member can accept or change the suggestion. A population must belong to
the chosen source, and the server rejects any mismatch.

## Dataset manifest (`micronutrient-references/v1`, retrieved 2026-10-23)

| Source                          | What is stored                                       | Where the values come from                                                                                                  | Licence                                                                                              |
| ------------------------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| EFSA Dietary Reference Values   | PRI, AI, UL and safe level for adults                | EFSA DRV Finder data (`multimedia.efsa.europa.eu/drvs`), each value cited by its scientific opinion's DOI                   | Re-use authorised with EFSA acknowledged as the source                                               |
| NASEM Dietary Reference Intakes | RDA, AI and UL for adults, as numbers with citations | DRI Summary Tables, Appendix J of _Dietary Reference Intakes for Sodium and Potassium_ (2019), and the original DRI reports | NASEM text and tables are not reproduced. NIH ODS fact sheets (public domain) are linked for reading |

Notes carried with the values:

- EFSA zinc depends on phytate intake, so it is shown as a range and never
  compared.
- The magnesium upper levels (EFSA and NASEM) apply to supplements only and
  are never compared with food.
- EFSA's 2024 iron opinion set a safe level of intake (40 mg/day), not a UL.
- NASEM vitamin C: people who smoke need 35 mg/day more.

Children, pregnancy and lactation are not included. The values are in
`packages/nutrition/src/micronutrient-references.ts`, and a test checks a
sample of them against the cited tables.

## Not done yet

- Entering micronutrients for custom foods.
- More nutrients. Folate, vitamin A and vitamin E need equivalence units
  (DFE, RAE, α-tocopherol) that the catalogs don't report the same way.
- An independent review of the reference values before this is presented as
  more than general information.
