import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";

import type {
  Applicability,
  DeclarationAnswer,
  EvidenceCertainty,
  EvidenceEntry,
  EvidenceVerdict,
  ItemPlan,
  PreventiveAuthority,
  PreventiveBand,
  PreventiveCareResult,
  PreventiveGrade,
  PreventiveItemView,
  PreventiveRegion,
} from "../preventive-care-contract";
import {
  unavailableExplanation,
  type WellnessUnavailableReason,
} from "../wellness-profile-contract";
import { formatInsightDate } from "./insights";
import type { InsightPushContent } from "./insights";

/**
 * Issue #97 — reviewed copy and view models for preventive care and the
 * evidence-check library, shared by web, native, push and email. Pure.
 *
 * Copy rules (CONTRIBUTING.md health-data rules, issue #97): the app shows what
 * an authority publishes, with its own grade, date and link; it never
 * diagnoses, assesses risk, urges or counts down. No "overdue", "urgent",
 * "critical" or alarm wording; individual-decision items say "talk to your
 * clinician". `preventive-care.test.ts` renders every item and fails on
 * banned wording.
 */

export const PREVENTIVE_COPY = {
  pageTitle: "Preventive care",
  pageIntro:
    "What public-health authorities in your region publish for people of your age and sex, with the source of each item. This is general public-health information, not personal medical advice, and it may not apply to you. Talk to your clinician about what is right for you.",
  regionLine: (region: string) =>
    `Showing guidance for: ${region}. Change your region in your profile.`,
  noRegion:
    "Choose your region in your profile to see guidance from public-health authorities there. Without a region, no list is shown.",
  adultsOnly:
    "Preventive-care guidance is for adults. It turns on after you confirm in your profile that you are 18 or older.",
  ownerOnly:
    "Preventive care is private to the person this workspace belongs to. Only the workspace owner can see it.",
  profileLink: "Open your profile",
  ageNote: (reason: WellnessUnavailableReason) =>
    `Your age range is not available: ${unavailableExplanation(reason)} Add your birth year (age band) in your profile to see which items apply to you. Nothing is guessed.`,
  sexNote: (reason: WellnessUnavailableReason) =>
    `Sex for reference tables is not available: ${unavailableExplanation(reason)} Items published for one sex say so instead of guessing.`,
  criteriaTitle: "Questions some items depend on",
  criteriaIntro:
    "Each answer is optional and only you can see it. Nothing is pre-selected, and you can choose “Prefer not to say” or clear an answer at any time.",
  clearAnswer: "Clear answer",
  notShownTitle: "Not shown for you",
  notShownIntro: "These items in your region do not match the age, sex or answers you gave.",
  empty: "No items for your region match what you have shared.",
  versionText: (packVersion: string, asOf: string) =>
    `Guidance pack ${packVersion}, as of ${asOf}.`,
  disclaimer:
    "OpenValens shows public information from these authorities. They have not reviewed or endorsed this app.",
  reportProblem: "Report a problem with this guidance",
  reportProblemUrl: (itemId: string) =>
    `https://github.com/nip10/openvalens/issues/new?title=${encodeURIComponent(`Guidance problem: ${itemId}`)}&labels=guidance`,
  beingReviewed:
    "This item is being reviewed against its source. Its details and reminders are paused until that check is done.",
  sourceLink: "Read the source",
  decisionAid: "Find a decision aid (Ottawa inventory of patient decision aids)",
  talkToClinician:
    "An individual decision. Talk to your clinician about whether it is right for you.",
  expectInvitationHint:
    "This programme invites people itself. OpenValens does not replace that invitation.",
  dateReached: "The date you set has arrived.",
  lastDone: "Last done",
  nextDate: "Next date you set",
  remind: "Remind me on this date (push or email, if turned on in insight notifications)",
  useSuggestion: (date: string) => `Use ${date} (from the published interval)`,
  plans: {
    none: "No plan recorded",
    expect_invitation: "Expect your invitation",
    decided_yes: "Decided: yes",
    decided_no: "Decided: no",
    decided_later: "Decide later",
  } satisfies Record<ItemPlan, string>,
  libraryToggle: "Show the evidence-check library",
  libraryToggleHint:
    "Off by default. A separate list that rates popular longevity practices and tests against published trials and guidelines. It never sets reminders.",
} as const;

export const DECLARATION_LABELS: Record<DeclarationAnswer, string> = {
  yes: "Yes",
  no: "No",
  prefer_not_to_say: "Prefer not to say",
};

export const REGION_AUTHORITY_LABELS: Record<PreventiveRegion, string> = {
  us: "United States",
  uk: "United Kingdom (England)",
  pt: "Portugal (EU)",
};

export const AUTHORITY_INFO: Record<PreventiveAuthority, { name: string; nonEndorsement: string }> =
  {
    uspstf: {
      name: "the US Preventive Services Task Force (USPSTF)",
      nonEndorsement: "Not endorsed by AHRQ, HHS or the USPSTF.",
    },
    nhs_england: {
      name: "the NHS in England",
      nonEndorsement: "The NHS has not reviewed or endorsed this app.",
    },
    dgs: {
      name: "Direção-Geral da Saúde (DGS), Portugal",
      nonEndorsement: "The DGS has not reviewed or endorsed this app.",
    },
  };

export const BAND_LABELS: Record<PreventiveBand, string> = {
  recommended: "Recommended",
  programme: "Offered by a health-system programme",
  individual_decision: "Individual decision",
  evidence_uncertain: "Evidence uncertain",
  not_recommended: "Not recommended",
};

/** The authority's own grade, readable without colour. */
export function gradeLabel(grade: PreventiveGrade): string {
  if (grade.scale === "programme") {
    switch (grade.value) {
      case "nhs_screening_programme":
        return "Offered by NHS screening programme (England)";
      case "nhs_health_check":
        return "Offered by NHS Health Check (England)";
      case "sns_screening_programme":
        return "Offered by SNS screening programme (Portugal)";
    }
  }
  switch (grade.value) {
    case "A":
    case "B":
      return `Recommended (USPSTF ${grade.value})`;
    case "C":
      return "Individual decision: discuss with your clinician (USPSTF C)";
    case "I":
      return "Evidence uncertain (USPSTF I)";
    case "D":
      return "Not recommended (USPSTF D)";
  }
}

const SEX_PHRASE = { female: "women", male: "men", any: "adults" } as const;

export function populationText(view: Pick<PreventiveItemView, "population">): string {
  const { sex, minAge, maxAge } = view.population;
  const ages =
    maxAge === null
      ? `${minAge} and older`
      : minAge === maxAge
        ? `${minAge}`
        : `${minAge} to ${maxAge}`;
  return `For ${SEX_PHRASE[sex]} aged ${ages}`;
}

export const APPLICABILITY_TEXT: Record<Applicability, string> = {
  applies: "Matches the age, sex and answers you shared.",
  may_apply: "May apply to you, depending on your answer to a question below.",
  age_edge:
    "Your birth year sits at the edge of this item's age range, so it may or may not apply yet.",
  needs_age: "Add your age band in your profile to see whether this applies.",
  needs_sex:
    "Published for one sex. Add the sex used for reference tables in your profile to see whether this applies.",
  outside_age_or_sex: "Outside the published age or sex for this item.",
  declared_not_met: "Your answers do not match this item.",
};

/** Long date ("30 Apr 2024") from YYYY-MM-DD. */
export function formatGuidanceDate(date: string): string {
  return `${formatInsightDate(date)} ${date.slice(0, 4)}`;
}

/** The framing line every item carries. */
export function framingText(view: Pick<PreventiveItemView, "authority" | "statementDate">): string {
  return `Information from ${AUTHORITY_INFO[view.authority].name}, published ${formatGuidanceDate(view.statementDate)}. General public-health guidance, not personal medical advice. It may not apply to you.`;
}

export type PreventiveItemCard = {
  key: string;
  title: string;
  /** Authority grade label (text, never colour only). */
  gradeLabel: string;
  band: PreventiveBand;
  beingReviewed: boolean;
  /** Short factual lines: population, interval, note. Empty while being reviewed. */
  facts: string[];
  applicabilityText: string;
  framing: string;
  citation: string;
  nonEndorsement: string;
  sourceUrl: string;
  decisionAidUrl: string | null;
  /** The person's own state, in words. */
  stateLines: string[];
  dateReachedText: string | null;
  accessibilityLabel: string;
};

export function preventiveItemCard(view: PreventiveItemView): PreventiveItemCard {
  const label = gradeLabel(view.grade);
  const facts = view.beingReviewed
    ? []
    : [
        populationText(view),
        ...(view.intervalText ? [view.intervalText] : []),
        ...(view.note ? [view.note] : []),
        ...(view.band === "individual_decision" ? [PREVENTIVE_COPY.talkToClinician] : []),
        ...(view.reminderMode === "expect_invitation"
          ? [PREVENTIVE_COPY.expectInvitationHint]
          : []),
      ];
  const stateLines: string[] = [];
  if (view.state.plan !== "none") stateLines.push(PREVENTIVE_COPY.plans[view.state.plan]);
  if (view.state.lastDoneOn)
    stateLines.push(`${PREVENTIVE_COPY.lastDone}: ${formatGuidanceDate(view.state.lastDoneOn)}`);
  if (view.state.nextOn && view.canRemind)
    stateLines.push(
      `${PREVENTIVE_COPY.nextDate}: ${formatGuidanceDate(view.state.nextOn)}${view.state.remind ? " (reminder on)" : ""}`,
    );
  const citation = `${view.statementTitle}. ${view.sourceVersion}. Retrieved ${formatGuidanceDate(view.retrievedOn)}; last checked ${formatGuidanceDate(view.reviewedOn)}.`;
  return {
    key: view.id,
    title: view.title,
    gradeLabel: label,
    band: view.band,
    beingReviewed: view.beingReviewed,
    facts,
    applicabilityText: APPLICABILITY_TEXT[view.applicability],
    framing: framingText(view),
    citation,
    nonEndorsement: AUTHORITY_INFO[view.authority].nonEndorsement,
    sourceUrl: view.sourceUrl,
    decisionAidUrl: view.beingReviewed ? null : view.decisionAidUrl,
    stateLines,
    dateReachedText: view.dateReached ? PREVENTIVE_COPY.dateReached : null,
    accessibilityLabel: `${view.title}. ${label}. ${APPLICABILITY_TEXT[view.applicability]}${
      view.beingReviewed ? ` ${PREVENTIVE_COPY.beingReviewed}` : ""
    }`,
  };
}

/** Page-level messages for a result (status, missing profile inputs, version). */
export function preventivePageNotes(result: PreventiveCareResult): {
  statusText: string | null;
  notes: string[];
  versionText: string;
} {
  const statusText =
    result.status === "no_region"
      ? PREVENTIVE_COPY.noRegion
      : result.status === "adult_confirmation_required"
        ? PREVENTIVE_COPY.adultsOnly
        : result.status === "owner_only"
          ? PREVENTIVE_COPY.ownerOnly
          : null;
  const notes: string[] = [];
  if (result.status === "available") {
    if (result.region)
      notes.push(PREVENTIVE_COPY.regionLine(REGION_AUTHORITY_LABELS[result.region]));
    if (result.ageUnavailable) notes.push(PREVENTIVE_COPY.ageNote(result.ageUnavailable));
    if (result.sexUnavailable) notes.push(PREVENTIVE_COPY.sexNote(result.sexUnavailable));
    if (result.items.length === 0) notes.push(PREVENTIVE_COPY.empty);
  }
  return {
    statusText,
    notes,
    versionText: PREVENTIVE_COPY.versionText(result.packVersion, result.asOf),
  };
}

// ─── reminders (push / email) ──────────────────────────────────

export const REMINDER_PUSH_BODY = msg`You have a reminder`;

/**
 * The only text a reminder push may carry, in the recipient's language
 * (#231). Fixed and generic: it never names the item, a health topic, a date
 * or a value, so nothing health-related reaches a lock screen or a push
 * provider. The title is the app name, a brand that is never translated.
 */
export function reminderPushContent(i18n: I18n): InsightPushContent {
  return { title: "OpenValens", body: i18n._(REMINDER_PUSH_BODY) };
}

/** Reminder email: generic too — the item is shown only inside the app. */
export const REMINDER_EMAIL_COPY = {
  subject: msg`You have a reminder in OpenValens`,
  title: msg`A date you set has arrived`,
  intro: msg`A date you set in OpenValens has arrived. Open the app to see it. This email does not include any health details.`,
  itemTitle: msg`Reminder`,
  itemLine: msg`Open OpenValens to see which date you set.`,
  none: msg`Nothing is due.`,
  footer: msg`You get this email because you set a reminder in OpenValens and turned on email notifications.`,
  unsubscribe: msg`Turn off these emails`,
  manage: msg`Open OpenValens`,
} as const satisfies Record<string, MessageDescriptor>;

// ─── evidence-check library ────────────────────────────────────

export const CERTAINTY_LABELS: Record<EvidenceCertainty, string> = {
  high: "High certainty",
  moderate: "Moderate certainty (“probably”)",
  low: "Low certainty (“may”)",
  very_low: "Very low certainty (“the evidence is very uncertain”)",
  not_graded: "Authority grade or consensus (no certainty rating)",
};

export const VERDICT_LABELS: Record<EvidenceVerdict, string> = {
  guideline_backed: "Guideline-backed",
  clinician_decision: "Clinician decision for specific situations",
  may_help_slightly: "May help slightly",
  little_or_no_benefit: "Little or no benefit",
  evidence_uncertain: "Evidence uncertain",
  not_recommended: "Not recommended without a specific reason",
  investigational: "Investigational",
};

export const LIBRARY_COPY = {
  title: "Evidence check",
  intro:
    "How popular longevity practices and tests hold up in published trials and guidelines. For information only: no doses, no reminders, and not personal medical advice. Most trial participants were 50 or older, so results apply less directly to younger adults. Talk to your clinician before starting or stopping anything.",
  off: "The evidence-check library is off. Turn it on in the preventive-care settings to see it.",
  needsCheck: "Source taken from the project's research brief; awaiting a maintainer check.",
} as const;

export type EvidenceEntryCard = {
  key: string;
  title: string;
  verdictLabel: string;
  certaintyLabel: string;
  lines: string[];
  sources: { citation: string; url: string; note: string | null }[];
};

export function evidenceEntryCard(entry: EvidenceEntry): EvidenceEntryCard {
  return {
    key: entry.id,
    title: entry.title,
    verdictLabel: VERDICT_LABELS[entry.verdict],
    certaintyLabel: CERTAINTY_LABELS[entry.certainty],
    lines: [
      entry.summary,
      ...(entry.harms ? [`Harms: ${entry.harms}`] : []),
      ...(entry.cautions ? [`Take care: ${entry.cautions}`] : []),
    ],
    sources: entry.sources.map((source) => ({
      citation: source.citation,
      url: source.url,
      note: source.verification === "from_research_brief" ? LIBRARY_COPY.needsCheck : null,
    })),
  };
}
