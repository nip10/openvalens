import type { PreventivePack } from "./preventive-care-contract";

/**
 * Issue #97 — the preventive-care rule pack. Versioned data, not code.
 *
 * Every item is a short set of facts (population, interval, grade, title)
 * taken from one primary public source and stored with its deep link,
 * statement date, source version, retrieval date, reviewer and expiry. No
 * guideline text is copied beyond these short fields, nothing is merged across
 * authorities, and no interval is invented: `suggestMonths` is set only when
 * the source states a single fixed interval.
 *
 * Fidelity: each item's fields were compared with the linked page on
 * `retrievedOn` during authoring. A maintainer still has to confirm them
 * before release (`reviewer` says so); see `docs/preventive-care.md` for the
 * review procedure and the items deliberately left out because their source
 * could not be verified.
 *
 * Changing any field of an item: bump its `version`, update `retrievedOn` /
 * `reviewedOn` / `reviewBy`, and bump the pack `version`.
 */

const RETRIEVED = "2026-10-16";
const REVIEW_BY = "2027-01-14"; // 90 days after review
const REVIEWER = "Source retrieval by agent; maintainer fidelity sign-off pending";

const USPSTF_ITEM = {
  region: "us",
  authority: "uspstf",
  retrievedOn: RETRIEVED,
  reviewer: REVIEWER,
  reviewedOn: RETRIEVED,
  reviewBy: REVIEW_BY,
} as const;

const NHS_ITEM = {
  region: "uk",
  authority: "nhs_england",
  retrievedOn: RETRIEVED,
  reviewer: REVIEWER,
  reviewedOn: RETRIEVED,
  reviewBy: REVIEW_BY,
  reminderMode: "expect_invitation",
  decisionAidUrl: null,
} as const;

/** Index of validated patient decision aids (Ottawa Hospital Research Institute). */
const DECISION_AID_INVENTORY = "https://decisionaid.ohri.ca/AZinvent.php";

export const PREVENTIVE_CARE_PACK: PreventivePack = {
  version: "2026-10-16.1",
  maxReviewDays: 90,
  criteria: [
    {
      id: "uspstf_lung_smoking_history",
      question:
        "Do you have a smoking history of at least 20 pack-years, and either smoke now or quit within the past 15 years?",
      purpose:
        "Optional. Only used to show whether one listed item may apply to you. One pack-year is about one pack a day for a year. Stored privately; clear it any time.",
    },
    {
      id: "ever_smoked",
      question: "Have you ever smoked?",
      purpose:
        "Optional. Only used to show whether a listed item may apply to you. Stored privately; clear it any time.",
    },
    {
      id: "nhs_health_check_listed_condition",
      question:
        "Have you been told you have any of the conditions the NHS lists as not eligible for the NHS Health Check?",
      purpose:
        "Optional. The NHS page linked on the item lists them. Only used to show whether that item may apply to you. Stored privately; clear it any time.",
    },
  ],
  items: [
    // ─── United States: USPSTF (statements pinned by date) ───────
    {
      ...USPSTF_ITEM,
      id: "us.colorectal_screening_45_49",
      version: 1,
      title: "Colorectal screening",
      statementTitle: "Colorectal Cancer: Screening",
      statementDate: "2021-05-18",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/colorectal-cancer-screening",
      sourceVersion:
        "Final Recommendation Statement, 18 May 2021 (A for ages 50–75, B for ages 45–49)",
      grade: { scale: "uspstf", value: "B" },
      population: { sex: "any", minAge: 45, maxAge: 49, criteria: [] },
      intervalText: "Depends on the test chosen with your clinician",
      suggestMonths: null,
      reminderMode: "user_date",
      decisionAidUrl: null,
      note: "Ages 45 to 49 (grade B). Ages 50 to 75 are a separate grade A item.",
    },
    {
      ...USPSTF_ITEM,
      id: "us.colorectal_screening_50_75",
      version: 1,
      title: "Colorectal screening",
      statementTitle: "Colorectal Cancer: Screening",
      statementDate: "2021-05-18",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/colorectal-cancer-screening",
      sourceVersion:
        "Final Recommendation Statement, 18 May 2021 (A for ages 50–75, B for ages 45–49)",
      grade: { scale: "uspstf", value: "A" },
      population: { sex: "any", minAge: 50, maxAge: 75, criteria: [] },
      intervalText: "Depends on the test chosen with your clinician",
      suggestMonths: null,
      reminderMode: "user_date",
      decisionAidUrl: null,
      note: null,
    },
    {
      ...USPSTF_ITEM,
      id: "us.breast_screening",
      version: 1,
      title: "Breast screening (mammogram)",
      statementTitle: "Breast Cancer: Screening",
      statementDate: "2024-04-30",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/breast-cancer-screening",
      sourceVersion: "Final Recommendation Statement, 30 April 2024",
      grade: { scale: "uspstf", value: "B" },
      population: { sex: "female", minAge: 40, maxAge: 74, criteria: [] },
      intervalText: "Every 2 years",
      suggestMonths: 24,
      reminderMode: "user_date",
      decisionAidUrl: null,
      note: null,
    },
    {
      ...USPSTF_ITEM,
      id: "us.cervical_screening",
      version: 1,
      title: "Cervical screening",
      statementTitle: "Cervical Cancer: Screening",
      statementDate: "2018-08-21",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/cervical-cancer-screening",
      sourceVersion:
        "Final Recommendation Statement, 21 August 2018 (topic marked as being updated)",
      grade: { scale: "uspstf", value: "A" },
      population: { sex: "female", minAge: 21, maxAge: 65, criteria: [] },
      intervalText:
        "Every 3 years at ages 21–29; every 3 or 5 years at ages 30–65, depending on the test",
      suggestMonths: null,
      reminderMode: "user_date",
      decisionAidUrl: null,
      note: "The USPSTF page says this topic is being updated; this item cites the 2018 statement.",
    },
    {
      ...USPSTF_ITEM,
      id: "us.lung_screening",
      version: 1,
      title: "Lung screening (low-dose CT)",
      statementTitle: "Lung Cancer: Screening",
      statementDate: "2021-03-09",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/lung-cancer-screening",
      sourceVersion: "Final Recommendation Statement, 9 March 2021",
      grade: { scale: "uspstf", value: "B" },
      population: {
        sex: "any",
        minAge: 50,
        maxAge: 80,
        criteria: [{ criterion: "uspstf_lung_smoking_history", meetsWhen: "yes" }],
      },
      intervalText: "Every year",
      suggestMonths: 12,
      reminderMode: "user_date",
      decisionAidUrl: null,
      note: null,
    },
    {
      ...USPSTF_ITEM,
      id: "us.aaa_screening",
      version: 1,
      title: "Abdominal aortic aneurysm (AAA) screening",
      statementTitle: "Abdominal Aortic Aneurysm: Screening",
      statementDate: "2019-12-10",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/abdominal-aortic-aneurysm-screening",
      sourceVersion: "Final Recommendation Statement, 10 December 2019",
      grade: { scale: "uspstf", value: "B" },
      population: {
        sex: "male",
        minAge: 65,
        maxAge: 75,
        criteria: [{ criterion: "ever_smoked", meetsWhen: "yes" }],
      },
      intervalText: "Once (ultrasound)",
      suggestMonths: null,
      reminderMode: "user_date",
      decisionAidUrl: null,
      note: null,
    },
    {
      ...USPSTF_ITEM,
      id: "us.osteoporosis_screening",
      version: 1,
      title: "Osteoporosis screening",
      statementTitle: "Osteoporosis to Prevent Fractures: Screening",
      statementDate: "2025-01-14",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/osteoporosis-screening",
      sourceVersion: "Final Recommendation Statement, 14 January 2025",
      grade: { scale: "uspstf", value: "B" },
      population: { sex: "female", minAge: 65, maxAge: null, criteria: [] },
      intervalText: null,
      suggestMonths: null,
      reminderMode: "user_date",
      decisionAidUrl: null,
      note: null,
    },
    {
      ...USPSTF_ITEM,
      id: "us.blood_pressure_screening",
      version: 1,
      title: "Blood pressure screening",
      statementTitle: "Hypertension in Adults: Screening",
      statementDate: "2021-04-27",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/hypertension-in-adults-screening",
      sourceVersion: "Final Recommendation Statement, 27 April 2021",
      grade: { scale: "uspstf", value: "A" },
      population: { sex: "any", minAge: 18, maxAge: null, criteria: [] },
      intervalText: null,
      suggestMonths: null,
      reminderMode: "user_date",
      decisionAidUrl: null,
      note: "For adults without a known blood pressure condition, measured in a clinic.",
    },
    {
      ...USPSTF_ITEM,
      id: "us.hepatitis_c_screening",
      version: 1,
      title: "Hepatitis C screening",
      statementTitle: "Hepatitis C Virus Infection in Adolescents and Adults: Screening",
      statementDate: "2020-03-02",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/hepatitis-c-screening",
      sourceVersion: "Final Recommendation Statement, 2 March 2020",
      grade: { scale: "uspstf", value: "B" },
      population: { sex: "any", minAge: 18, maxAge: 79, criteria: [] },
      intervalText: null,
      suggestMonths: null,
      reminderMode: "user_date",
      decisionAidUrl: null,
      note: null,
    },
    {
      ...USPSTF_ITEM,
      id: "us.hiv_screening",
      version: 1,
      title: "HIV screening",
      statementTitle: "Human Immunodeficiency Virus (HIV) Infection: Screening",
      statementDate: "2019-06-11",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/human-immunodeficiency-virus-hiv-infection-screening",
      sourceVersion: "Final Recommendation Statement, 11 June 2019 (topic marked as being updated)",
      grade: { scale: "uspstf", value: "A" },
      population: { sex: "any", minAge: 18, maxAge: 65, criteria: [] },
      intervalText: null,
      suggestMonths: null,
      reminderMode: "user_date",
      decisionAidUrl: null,
      note: "The statement covers ages 15 to 65; OpenValens shows it to adults only.",
    },
    {
      ...USPSTF_ITEM,
      id: "us.prostate_psa_55_69",
      version: 1,
      title: "Prostate (PSA) screening",
      statementTitle: "Prostate Cancer: Screening",
      statementDate: "2018-05-08",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/prostate-cancer-screening",
      sourceVersion: "Final Recommendation Statement, 8 May 2018 (topic marked as being updated)",
      grade: { scale: "uspstf", value: "C" },
      population: { sex: "male", minAge: 55, maxAge: 69, criteria: [] },
      intervalText: null,
      suggestMonths: null,
      reminderMode: "none",
      decisionAidUrl: DECISION_AID_INVENTORY,
      note: "An individual decision to make with your clinician.",
    },
    {
      ...USPSTF_ITEM,
      id: "us.prostate_psa_70_plus",
      version: 1,
      title: "Prostate (PSA) screening",
      statementTitle: "Prostate Cancer: Screening",
      statementDate: "2018-05-08",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/prostate-cancer-screening",
      sourceVersion: "Final Recommendation Statement, 8 May 2018 (topic marked as being updated)",
      grade: { scale: "uspstf", value: "D" },
      population: { sex: "male", minAge: 70, maxAge: null, criteria: [] },
      intervalText: null,
      suggestMonths: null,
      reminderMode: "none",
      decisionAidUrl: null,
      note: null,
    },
    {
      ...USPSTF_ITEM,
      id: "us.hearing_screening",
      version: 1,
      title: "Hearing screening",
      statementTitle: "Hearing Loss in Older Adults: Screening",
      statementDate: "2021-03-23",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/hearing-loss-in-older-adults-screening",
      sourceVersion: "Final Recommendation Statement, 23 March 2021",
      grade: { scale: "uspstf", value: "I" },
      population: { sex: "any", minAge: 50, maxAge: null, criteria: [] },
      intervalText: null,
      suggestMonths: null,
      reminderMode: "none",
      decisionAidUrl: null,
      note: "For adults without symptoms.",
    },
    {
      ...USPSTF_ITEM,
      id: "us.vision_screening",
      version: 1,
      title: "Vision screening",
      statementTitle: "Impaired Visual Acuity in Older Adults: Screening",
      statementDate: "2022-05-24",
      sourceUrl:
        "https://www.uspreventiveservicestaskforce.org/uspstf/recommendation/impaired-visual-acuity-screening-older-adults",
      sourceVersion: "Final Recommendation Statement, 24 May 2022",
      grade: { scale: "uspstf", value: "I" },
      population: { sex: "any", minAge: 65, maxAge: null, criteria: [] },
      intervalText: null,
      suggestMonths: null,
      reminderMode: "none",
      decisionAidUrl: null,
      note: "For adults without symptoms.",
    },

    // ─── United Kingdom: NHS England (invitation-based programmes) ─
    {
      ...NHS_ITEM,
      id: "uk.cervical_screening",
      version: 1,
      title: "Cervical screening",
      statementTitle: "NHS cervical screening",
      statementDate: RETRIEVED,
      sourceUrl: "https://www.nhs.uk/tests-and-treatments/cervical-screening/",
      sourceVersion: "nhs.uk page as retrieved 16 October 2026 (no review date shown)",
      grade: { scale: "programme", value: "nhs_screening_programme" },
      population: { sex: "female", minAge: 25, maxAge: 64, criteria: [] },
      intervalText: "Invited every 5 years",
      suggestMonths: 60,
      note: "England. The NHS invites everyone with a cervix aged 25 to 64. Scotland, Wales and Northern Ireland run their own programmes.",
    },
    {
      ...NHS_ITEM,
      id: "uk.breast_screening",
      version: 1,
      title: "Breast screening (mammogram)",
      statementTitle: "NHS breast screening: when you'll be invited and who should go",
      statementDate: "2025-10-09",
      sourceUrl:
        "https://www.nhs.uk/tests-and-treatments/breast-screening-mammogram/when-youll-be-invited-and-who-should-go/",
      sourceVersion: "nhs.uk page last reviewed 9 October 2025",
      grade: { scale: "programme", value: "nhs_screening_programme" },
      population: { sex: "female", minAge: 50, maxAge: 70, criteria: [] },
      intervalText: "Invited every 3 years until your 71st birthday",
      suggestMonths: 36,
      note: "England. From 71 you can ask your local breast screening service for an appointment.",
    },
    {
      ...NHS_ITEM,
      id: "uk.bowel_screening",
      version: 1,
      title: "Bowel screening (home test kit)",
      statementTitle: "NHS bowel cancer screening",
      statementDate: "2024-10-11",
      sourceUrl: "https://www.nhs.uk/tests-and-treatments/bowel-cancer-screening/",
      sourceVersion: "nhs.uk page last reviewed 11 October 2024",
      grade: { scale: "programme", value: "nhs_screening_programme" },
      population: { sex: "any", minAge: 50, maxAge: 74, criteria: [] },
      intervalText: "A kit is posted every 2 years",
      suggestMonths: 24,
      note: "England, for people registered with a GP. From 75 you can ask for a kit.",
    },
    {
      ...NHS_ITEM,
      id: "uk.aaa_screening",
      version: 1,
      title: "Abdominal aortic aneurysm (AAA) screening",
      statementTitle: "NHS abdominal aortic aneurysm (AAA) screening",
      statementDate: "2024-11-11",
      sourceUrl: "https://www.nhs.uk/tests-and-treatments/abdominal-aortic-aneurysm-screening/",
      sourceVersion: "nhs.uk page last reviewed 11 November 2024",
      grade: { scale: "programme", value: "nhs_screening_programme" },
      population: { sex: "male", minAge: 65, maxAge: 65, criteria: [] },
      intervalText: "Once, in the year you turn 65",
      suggestMonths: null,
      note: "England. If you were not invited, the NHS page explains how to contact your local AAA screening service.",
    },
    {
      ...NHS_ITEM,
      id: "uk.lung_health_check",
      version: 1,
      title: "Lung health check",
      statementTitle: "NHS lung cancer screening",
      statementDate: "2023-03-27",
      sourceUrl: "https://www.nhs.uk/tests-and-treatments/lung-cancer-screening/",
      sourceVersion: "nhs.uk page last reviewed 27 March 2023",
      grade: { scale: "programme", value: "nhs_screening_programme" },
      population: {
        sex: "any",
        minAge: 55,
        maxAge: 74,
        criteria: [{ criterion: "ever_smoked", meetsWhen: "yes" }],
      },
      intervalText: null,
      suggestMonths: null,
      note: "England, only in areas where lung health checks are offered, for people registered with a GP.",
    },
    {
      ...NHS_ITEM,
      id: "uk.nhs_health_check",
      version: 1,
      title: "NHS Health Check",
      statementTitle: "NHS Health Check",
      statementDate: "2023-08-14",
      sourceUrl: "https://www.nhs.uk/tests-and-treatments/nhs-health-check/",
      sourceVersion: "nhs.uk page last reviewed 14 August 2023",
      grade: { scale: "programme", value: "nhs_health_check" },
      population: {
        sex: "any",
        minAge: 40,
        maxAge: 74,
        criteria: [{ criterion: "nhs_health_check_listed_condition", meetsWhen: "no" }],
      },
      intervalText: "Invited every 5 years",
      suggestMonths: 60,
      note: "England. The invitation comes from your GP surgery or local council.",
    },

    // ─── Portugal: DGS / SNS (invitation-based programmes) ──────
    {
      id: "pt.cervical_screening",
      version: 1,
      region: "pt",
      authority: "dgs",
      title: "Cervical screening (HPV test)",
      statementTitle:
        "Norma DGS n.º 09/2024 — Programa de rastreio de base populacional do Cancro do Colo do Útero",
      statementDate: "2024-10-17",
      sourceUrl:
        "https://www.dgs.pt/normas-orientacoes-e-informacoes/normas-e-circulares-normativas/norma-092024-de-17102024-programa-de-rastreio-de-base-populacional-do-cancro-do-colo-do-utero1.aspx",
      sourceVersion: "Norma DGS n.º 09/2024 de 17/10/2024",
      retrievedOn: RETRIEVED,
      grade: { scale: "programme", value: "sns_screening_programme" },
      population: { sex: "female", minAge: 30, maxAge: 69, criteria: [] },
      intervalText: "Repeated after 5 years when the HPV test is negative",
      suggestMonths: 60,
      reminderMode: "expect_invitation",
      decisionAidUrl: null,
      note: "Portugal. The programme invites people with a cervix who turn 30 to 69 in the year of the invitation.",
      reviewer: REVIEWER,
      reviewedOn: RETRIEVED,
      reviewBy: REVIEW_BY,
    },
  ],
};

/** Looks an item up by id across every region (history survives a region change). */
export function findPreventiveItem(
  id: string,
  pack: PreventivePack = PREVENTIVE_CARE_PACK,
): PreventivePack["items"][number] | null {
  return pack.items.find((item) => item.id === id) ?? null;
}
