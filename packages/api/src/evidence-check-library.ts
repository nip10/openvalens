import type { EvidenceLibrary } from "./preventive-care-contract";

/**
 * Issue #97 — the evidence-check library: an opt-in, read-only list that
 * rates popular longevity practices and tests against primary evidence.
 *
 * Rules (enforced by `evidence-check-library.test.ts`):
 * - Off by default; never turned into a reminder.
 * - No doses, no product recommendations, never a personality as authority.
 * - Every entry cites primary evidence (trials, systematic reviews,
 *   guidelines or consensus statements) and carries a certainty label in
 *   GRADE plain-language wording ("will" / "probably" / "may" / "very
 *   uncertain").
 * - `verification` says whether the cited fields were compared with the source
 *   during authoring or come from the repo's research brief and still need a
 *   maintainer check.
 */

const CHECKED = "2026-10-16";
const BRIEF = "2026-10-02";
const REVIEW_BY = "2027-01-14";

export const EVIDENCE_CHECK_LIBRARY: EvidenceLibrary = {
  version: "2026-10-16.1",
  entries: [
    {
      id: "vitamin_d_supplements",
      version: 1,
      title: "Vitamin D supplements and blood tests",
      verdict: "little_or_no_benefit",
      certainty: "moderate",
      summary:
        "For healthy adults, vitamin D supplements probably make little or no difference to cancer or major heart and circulation events. An Endocrine Society guideline (2024) suggests against routine vitamin D blood testing in the general adult population and sets no target level.",
      harms: null,
      cautions: null,
      sources: [
        {
          citation: "VITAL randomised trial, main findings (vitalstudy.org)",
          url: "https://www.vitalstudy.org/findings.html",
          kind: "randomised_trial",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
        {
          citation: "Neale RE et al. D-Health trial. Lancet Diabetes Endocrinol. 2022",
          url: "https://www.thelancet.com/journals/landia/article/PIIS2213-8587(21)00345-4/abstract",
          kind: "randomised_trial",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
        {
          citation:
            "Endocrine Society. Vitamin D for the Prevention of Disease. Clinical Practice Guideline, 2024",
          url: "https://www.endocrine.org/clinical-practice-guidelines/vitamin-d-for-prevention-of-disease",
          kind: "guideline",
          verification: "checked_on_retrieval",
          retrievedOn: CHECKED,
        },
      ],
      reviewBy: REVIEW_BY,
    },
    {
      id: "omega_3_supplements",
      version: 1,
      title: "Omega-3 (fish oil) supplements",
      verdict: "little_or_no_benefit",
      certainty: "moderate",
      summary:
        "In large trials, over-the-counter omega-3 supplements probably make little or no difference to major heart and circulation events. A trial of a prescription product in a specific group does not transfer to over-the-counter fish oil.",
      harms:
        "A meta-analysis of randomised trials found more atrial fibrillation (an irregular heart rhythm) with omega-3 supplements.",
      cautions: null,
      sources: [
        {
          citation: "VITAL randomised trial, main findings (vitalstudy.org)",
          url: "https://www.vitalstudy.org/findings.html",
          kind: "randomised_trial",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
        {
          citation: "Nicholls SJ et al. STRENGTH randomised trial. JAMA. 2020",
          url: "https://jamanetwork.com/journals/jama/fullarticle/2778119",
          kind: "randomised_trial",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
        {
          citation:
            "Gencer B et al. Omega-3 supplementation and atrial fibrillation: meta-analysis. Circulation. 2021",
          url: "https://www.ahajournals.org/doi/10.1161/CIRCULATIONAHA.121.057464",
          kind: "systematic_review",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
      ],
      reviewBy: REVIEW_BY,
    },
    {
      id: "multivitamins",
      version: 1,
      title: "Multivitamins",
      verdict: "evidence_uncertain",
      certainty: "not_graded",
      summary:
        "The USPSTF (2022) found the evidence insufficient to judge benefits and harms of multivitamins for preventing heart disease or cancer (grade I).",
      harms: null,
      cautions: null,
      sources: [
        {
          citation:
            "USPSTF. Vitamin, Mineral, and Multivitamin Supplementation to Prevent Cardiovascular Disease and Cancer. 21 June 2022",
          url: "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/vitamin-supplementation-to-prevent-cvd-and-cancer-preventive-medication",
          kind: "guideline",
          verification: "checked_on_retrieval",
          retrievedOn: CHECKED,
        },
      ],
      reviewBy: REVIEW_BY,
    },
    {
      id: "beta_carotene_vitamin_e",
      version: 1,
      title: "Beta-carotene and vitamin E supplements",
      verdict: "not_recommended",
      certainty: "not_graded",
      summary:
        "The USPSTF (2022) recommends against beta-carotene or vitamin E supplements for preventing heart disease or cancer (grade D).",
      harms: "For beta-carotene, the USPSTF found that harms outweigh benefits.",
      cautions: null,
      sources: [
        {
          citation:
            "USPSTF. Vitamin, Mineral, and Multivitamin Supplementation to Prevent Cardiovascular Disease and Cancer. 21 June 2022",
          url: "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/vitamin-supplementation-to-prevent-cvd-and-cancer-preventive-medication",
          kind: "guideline",
          verification: "checked_on_retrieval",
          retrievedOn: CHECKED,
        },
      ],
      reviewBy: REVIEW_BY,
    },
    {
      id: "creatine",
      version: 1,
      title: "Creatine",
      verdict: "may_help_slightly",
      certainty: "low",
      summary:
        "Creatine may slightly help memory, with effects that vary by age and health; it showed no effect on overall cognition. The clearest uses studied are alongside resistance training. Most trials were small.",
      harms: null,
      cautions: null,
      sources: [
        {
          citation:
            "Xu C et al. Creatine supplementation and cognitive function: meta-analysis. 2024 (PMC11275561)",
          url: "https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11275561/",
          kind: "systematic_review",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
        {
          citation:
            "Prokopidis K et al. Creatine and memory: systematic review and meta-analysis. Nutr Rev. 2023",
          url: "https://academic.oup.com/nutritionreviews/article/81/4/416/6671817",
          kind: "systematic_review",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
      ],
      reviewBy: REVIEW_BY,
    },
    {
      id: "magnesium_sleep",
      version: 1,
      title: "Magnesium for falling asleep",
      verdict: "may_help_slightly",
      certainty: "very_low",
      summary:
        "Magnesium may shorten the time it takes to fall asleep slightly, but the evidence is very uncertain: three small trials with a high chance of bias.",
      harms: null,
      cautions:
        "The NIH Office of Dietary Supplements notes a higher chance of side effects from magnesium supplements in people with reduced kidney function.",
      sources: [
        {
          citation:
            "Mah J, Pitre T. Oral magnesium for insomnia in older adults: systematic review. BMC Complement Med Ther. 2021",
          url: "https://link.springer.com/article/10.1186/s12906-021-03297-z",
          kind: "systematic_review",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
        {
          citation:
            "NIH Office of Dietary Supplements. Magnesium fact sheet for health professionals",
          url: "https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/",
          kind: "reference",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
      ],
      reviewBy: REVIEW_BY,
    },
    {
      id: "routine_health_checks",
      version: 1,
      title: "Routine full blood panels and annual check-ups",
      verdict: "not_recommended",
      certainty: "high",
      summary:
        "General health checks for people without symptoms make little or no difference to deaths overall, from cancer, or from heart and circulation conditions (Cochrane review of 15 trials, about 250,000 people). Without a specific reason, routine screening blood tests are not advised.",
      harms: "The review names unnecessary tests and treatments as the expected harm.",
      cautions: null,
      sources: [
        {
          citation:
            "Krogsbøll LT et al. General health checks in adults. Cochrane Database Syst Rev. 2019 (CD009009.pub3)",
          url: "https://doi.org/10.1002/14651858.CD009009.pub3",
          kind: "systematic_review",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
        {
          citation: "Choosing Wisely Canada. Ordering routine blood work",
          url: "https://choosingwiselycanada.org/toolkit/ordering-routine-blood-work/",
          kind: "guideline",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
      ],
      reviewBy: REVIEW_BY,
    },
    {
      id: "lipoprotein_a_once",
      version: 1,
      title: "Lipoprotein(a) blood test once in a lifetime",
      verdict: "clinician_decision",
      certainty: "not_graded",
      summary:
        "A European Atherosclerosis Society consensus statement (2022) recommends measuring lipoprotein(a) at least once in adult life, because the level is largely inherited. Discuss with your clinician whether it is useful for you.",
      harms: null,
      cautions: null,
      sources: [
        {
          citation:
            "Kronenberg F et al. Lipoprotein(a) in atherosclerotic cardiovascular disease and aortic stenosis: a European Atherosclerosis Society consensus statement. Eur Heart J. 2022",
          url: "https://doi.org/10.1093/eurheartj/ehac361",
          kind: "consensus_statement",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
      ],
      reviewBy: REVIEW_BY,
    },
    {
      id: "coronary_calcium_score",
      version: 1,
      title: "Coronary calcium (CAC) scan",
      verdict: "clinician_decision",
      certainty: "not_graded",
      summary:
        "The ACC/AHA primary prevention guideline (2019) calls a coronary calcium scan reasonable for some adults when they and their clinician are unsure about starting a cholesterol medicine. It is a clinician decision for specific situations, not a general check-up scan.",
      harms: null,
      cautions: null,
      sources: [
        {
          citation:
            "Arnett DK et al. 2019 ACC/AHA Guideline on the Primary Prevention of Cardiovascular Disease. Circulation. 2019",
          url: "https://www.ahajournals.org/doi/10.1161/CIR.0000000000000678",
          kind: "guideline",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
      ],
      reviewBy: REVIEW_BY,
    },
    {
      id: "whole_body_mri",
      version: 1,
      title: "Whole-body MRI as a check-up",
      verdict: "not_recommended",
      certainty: "not_graded",
      summary:
        "In studies of 5,373 people without symptoms, whole-body MRI found incidental or unclear findings in about a quarter of them, many of which turned out to be nothing. The review authors advise against offering it as screening outside research.",
      harms: "Unclear findings lead to further tests and worry.",
      cautions: null,
      sources: [
        {
          citation:
            "Kwee RM, Kwee TC. Whole-body MRI for preventive health screening: systematic review. J Magn Reson Imaging. 2019",
          url: "https://onlinelibrary.wiley.com/doi/full/10.1002/jmri.26736",
          kind: "systematic_review",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
      ],
      reviewBy: REVIEW_BY,
    },
    {
      id: "multi_cancer_blood_tests",
      version: 1,
      title: "Multi-cancer blood tests",
      verdict: "investigational",
      certainty: "not_graded",
      summary:
        "These tests are still being studied. The NHS-Galleri randomised trial did not meet its main goal of fewer cancers found at a late stage, and no data on deaths exist yet.",
      harms: null,
      cautions: null,
      sources: [
        {
          citation: "NHS-Galleri randomised trial: main results update",
          url: "https://www.nhs-galleri.org/trial-updates/nhs-galleri-trial-reports-fewer-diagnoses-of-the-most-advanced-cancers",
          kind: "trial_report",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
      ],
      reviewBy: REVIEW_BY,
    },
    {
      id: "physical_activity",
      version: 1,
      title: "Physical activity and strength training",
      verdict: "guideline_backed",
      certainty: "not_graded",
      summary:
        "WHO guidelines (2020) for adults: 150–300 minutes of moderate activity, or 75–150 minutes of vigorous activity, each week, plus muscle-strengthening on 2 or more days. From 65, they add balance and multicomponent activity.",
      harms: null,
      cautions: null,
      sources: [
        {
          citation:
            "Bull FC et al. WHO 2020 guidelines on physical activity and sedentary behaviour. Br J Sports Med. 2020",
          url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7719906/",
          kind: "guideline",
          verification: "from_research_brief",
          retrievedOn: BRIEF,
        },
      ],
      reviewBy: REVIEW_BY,
    },
  ],
};
