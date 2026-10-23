import type { I18n, MessageDescriptor } from "@lingui/core";
import { msg, select } from "@lingui/core/macro";

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
import type { WellnessUnavailableReason } from "../wellness-profile-contract";
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
 *
 * Translated (#231): copy constants are Lingui message descriptors and the
 * card builders render through the `i18n` they are given. The guidance pack's
 * own text (item and statement titles, intervals, notes, evidence summaries)
 * is cited content and stays as published.
 */

export const PREVENTIVE_COPY = {
  pageTitle: msg`Preventive care`,
  pageIntro: msg({
    message:
      "What public-health authorities in your region publish for people of your age and sex, with the source of each item. This is general public-health information, not personal medical advice, and it may not apply to you. Talk to your clinician about what is right for you.",
    comment: "safety",
  }),
  regionLine: (region: string): MessageDescriptor =>
    msg`Showing guidance for: ${region}. Change your region in your profile.`,
  noRegion: msg`Choose your region in your profile to see guidance from public-health authorities there. Without a region, no list is shown.`,
  adultsOnly: msg`Preventive-care guidance is for adults. It turns on after you confirm in your profile that you are 18 or older.`,
  ownerOnly: msg`Preventive care is private to the person this workspace belongs to. Only the workspace owner can see it.`,
  profileLink: msg`Open your profile`,
  ageNote: (reason: WellnessUnavailableReason): MessageDescriptor =>
    msg`Your age range is not available: ${select(reason, {
      not_provided: "You haven't added this yet.",
      declined: "You chose not to share this.",
      not_applicable: "You said neither option fits you.",
      adult_confirmation_required: "This is only available after you confirm you are 18 or older.",
      consent_required: "This needs your consent for this purpose.",
      other: "Your birth year falls on the edge of two age bands.",
    })} Add your birth year (age band) in your profile to see which items apply to you. Nothing is guessed.`,
  sexNote: (reason: WellnessUnavailableReason): MessageDescriptor =>
    msg`Sex for reference tables is not available: ${select(reason, {
      not_provided: "You haven't added this yet.",
      declined: "You chose not to share this.",
      not_applicable: "You said neither option fits you.",
      adult_confirmation_required: "This is only available after you confirm you are 18 or older.",
      consent_required: "This needs your consent for this purpose.",
      other: "Your birth year falls on the edge of two age bands.",
    })} Items published for one sex say so instead of guessing.`,
  criteriaTitle: msg`Questions some items depend on`,
  criteriaIntro: msg`Each answer is optional and only you can see it. Nothing is pre-selected, and you can choose “Prefer not to say” or clear an answer at any time.`,
  clearAnswer: msg`Clear answer`,
  notShownTitle: msg`Not shown for you`,
  notShownIntro: msg`These items in your region do not match the age, sex or answers you gave.`,
  empty: msg`No items for your region match what you have shared.`,
  versionText: (packVersion: string, asOf: string): MessageDescriptor =>
    msg`Guidance pack ${packVersion}, as of ${asOf}.`,
  disclaimer: msg`OpenValens shows public information from these authorities. They have not reviewed or endorsed this app.`,
  reportProblem: msg`Report a problem with this guidance`,
  /** A GitHub issue for the maintainers: its title stays English on purpose. */
  reportProblemUrl: (itemId: string) =>
    `https://github.com/nip10/openvalens/issues/new?title=${encodeURIComponent(`Guidance problem: ${itemId}`)}&labels=guidance`,
  beingReviewed: msg`This item is being reviewed against its source. Its details and reminders are paused until that check is done.`,
  sourceLink: msg`Read the source`,
  decisionAid: msg`Find a decision aid (Ottawa inventory of patient decision aids)`,
  talkToClinician: msg({
    message: "An individual decision. Talk to your clinician about whether it is right for you.",
    comment: "safety",
  }),
  expectInvitationHint: msg`This programme invites people itself. OpenValens does not replace that invitation.`,
  dateReached: msg`The date you set has arrived.`,
  lastDone: msg`Last done`,
  nextDate: msg`Next date you set`,
  remind: msg`Remind me on this date (push or email, if turned on in insight notifications)`,
  useSuggestion: (date: string): MessageDescriptor =>
    msg`Use ${date} (from the published interval)`,
  plans: {
    none: msg`No plan recorded`,
    expect_invitation: msg`Expect your invitation`,
    decided_yes: msg`Decided: yes`,
    decided_no: msg`Decided: no`,
    decided_later: msg`Decide later`,
  } satisfies Record<ItemPlan, MessageDescriptor>,
  libraryToggle: msg`Show the evidence-check library`,
  libraryToggleHint: msg`Off by default. A separate list that rates popular longevity practices and tests against published trials and guidelines. It never sets reminders.`,
} as const;

export const DECLARATION_LABELS: Record<DeclarationAnswer, MessageDescriptor> = {
  yes: msg({ message: "Yes", context: "declaration answer" }),
  no: msg({ message: "No", context: "declaration answer" }),
  prefer_not_to_say: msg`Prefer not to say`,
};

export const REGION_AUTHORITY_LABELS: Record<PreventiveRegion, MessageDescriptor> = {
  us: msg`United States`,
  uk: msg`United Kingdom (England)`,
  pt: msg`Portugal (EU)`,
};

/** Each authority's own non-endorsement line. */
export const AUTHORITY_NON_ENDORSEMENT: Record<PreventiveAuthority, MessageDescriptor> = {
  uspstf: msg`Not endorsed by AHRQ, HHS or the USPSTF.`,
  nhs_england: msg`The NHS has not reviewed or endorsed this app.`,
  dgs: msg`The DGS has not reviewed or endorsed this app.`,
};

export const BAND_LABELS: Record<PreventiveBand, MessageDescriptor> = {
  recommended: msg({ message: "Recommended", comment: "safety" }),
  programme: msg({ message: "Offered by a health-system programme", comment: "safety" }),
  individual_decision: msg({ message: "Individual decision", comment: "safety" }),
  evidence_uncertain: msg({ message: "Evidence uncertain", comment: "safety" }),
  not_recommended: msg({ message: "Not recommended", comment: "safety" }),
};

/** The authority's own grade, readable without colour. */
export function gradeLabel(grade: PreventiveGrade): MessageDescriptor {
  if (grade.scale === "programme") {
    switch (grade.value) {
      case "nhs_screening_programme":
        return msg({
          message: "Offered by NHS screening programme (England)",
          comment: "safety",
        });
      case "nhs_health_check":
        return msg({ message: "Offered by NHS Health Check (England)", comment: "safety" });
      case "sns_screening_programme":
        return msg({
          message: "Offered by SNS screening programme (Portugal)",
          comment: "safety",
        });
    }
  }
  switch (grade.value) {
    case "A":
    case "B": {
      const letter = grade.value;
      return msg({ message: `Recommended (USPSTF ${letter})`, comment: "safety" });
    }
    case "C":
      return msg({
        message: "Individual decision: discuss with your clinician (USPSTF C)",
        comment: "safety",
      });
    case "I":
      return msg({ message: "Evidence uncertain (USPSTF I)", comment: "safety" });
    case "D":
      return msg({ message: "Not recommended (USPSTF D)", comment: "safety" });
  }
}

/** "For women aged 50 to 70": the published population, one whole sentence per age shape. */
export function populationText(view: Pick<PreventiveItemView, "population">): MessageDescriptor {
  const { sex, minAge, maxAge } = view.population;
  if (maxAge === null)
    return msg({
      message: `For ${select(sex, { female: "women", male: "men", other: "adults" })} aged ${minAge} and older`,
      comment: "safety",
    });
  if (minAge === maxAge)
    return msg({
      message: `For ${select(sex, { female: "women", male: "men", other: "adults" })} aged ${minAge}`,
      comment: "safety",
    });
  return msg({
    message: `For ${select(sex, { female: "women", male: "men", other: "adults" })} aged ${minAge} to ${maxAge}`,
    comment: "safety",
  });
}

export const APPLICABILITY_TEXT: Record<Applicability, MessageDescriptor> = {
  applies: msg({ message: "Matches the age, sex and answers you shared.", comment: "safety" }),
  may_apply: msg({
    message: "May apply to you, depending on your answer to a question below.",
    comment: "safety",
  }),
  age_edge: msg({
    message:
      "Your birth year sits at the edge of this item's age range, so it may or may not apply yet.",
    comment: "safety",
  }),
  needs_age: msg({
    message: "Add your age band in your profile to see whether this applies.",
    comment: "safety",
  }),
  needs_sex: msg({
    message:
      "Published for one sex. Add the sex used for reference tables in your profile to see whether this applies.",
    comment: "safety",
  }),
  outside_age_or_sex: msg({
    message: "Outside the published age or sex for this item.",
    comment: "safety",
  }),
  declared_not_met: msg({ message: "Your answers do not match this item.", comment: "safety" }),
};

/** Long date ("30 Apr 2024") from YYYY-MM-DD. */
export function formatGuidanceDate(date: string): string {
  return `${formatInsightDate(date)} ${date.slice(0, 4)}`;
}

/**
 * The framing line every item carries. Authority names are proper names and
 * stay as the authority writes them.
 */
export function framingText(
  view: Pick<PreventiveItemView, "authority" | "statementDate">,
): MessageDescriptor {
  const authority = view.authority;
  const published = formatGuidanceDate(view.statementDate);
  return msg({
    message: `Information from ${select(authority, {
      uspstf: "the US Preventive Services Task Force (USPSTF)",
      nhs_england: "the NHS in England",
      other: "Direção-Geral da Saúde (DGS), Portugal",
    })}, published ${published}. General public-health guidance, not personal medical advice. It may not apply to you.`,
    comment: "safety",
  });
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

/** One item, rendered in the language of `i18n`. Pack text (title, interval, note) is shown as published. */
export function preventiveItemCard(i18n: I18n, view: PreventiveItemView): PreventiveItemCard {
  const label = i18n._(gradeLabel(view.grade));
  const applicabilityText = i18n._(APPLICABILITY_TEXT[view.applicability]);
  const facts = view.beingReviewed
    ? []
    : [
        i18n._(populationText(view)),
        ...(view.intervalText ? [view.intervalText] : []),
        ...(view.note ? [view.note] : []),
        ...(view.band === "individual_decision" ? [i18n._(PREVENTIVE_COPY.talkToClinician)] : []),
        ...(view.reminderMode === "expect_invitation"
          ? [i18n._(PREVENTIVE_COPY.expectInvitationHint)]
          : []),
      ];
  const stateLines: string[] = [];
  if (view.state.plan !== "none") stateLines.push(i18n._(PREVENTIVE_COPY.plans[view.state.plan]));
  if (view.state.lastDoneOn) {
    const date = formatGuidanceDate(view.state.lastDoneOn);
    stateLines.push(i18n._(msg`Last done: ${date}`));
  }
  if (view.state.nextOn && view.canRemind) {
    const date = formatGuidanceDate(view.state.nextOn);
    stateLines.push(
      view.state.remind
        ? i18n._(msg`Next date you set: ${date} (reminder on)`)
        : i18n._(msg`Next date you set: ${date}`),
    );
  }
  const { statementTitle, sourceVersion } = view;
  const retrieved = formatGuidanceDate(view.retrievedOn);
  const checked = formatGuidanceDate(view.reviewedOn);
  const citation = i18n._(
    msg`${statementTitle}. ${sourceVersion}. Retrieved ${retrieved}; last checked ${checked}.`,
  );
  return {
    key: view.id,
    title: view.title,
    gradeLabel: label,
    band: view.band,
    beingReviewed: view.beingReviewed,
    facts,
    applicabilityText,
    framing: i18n._(framingText(view)),
    citation,
    nonEndorsement: i18n._(AUTHORITY_NON_ENDORSEMENT[view.authority]),
    sourceUrl: view.sourceUrl,
    decisionAidUrl: view.beingReviewed ? null : view.decisionAidUrl,
    stateLines,
    dateReachedText: view.dateReached ? i18n._(PREVENTIVE_COPY.dateReached) : null,
    accessibilityLabel: `${view.title}. ${label}. ${applicabilityText}${
      view.beingReviewed ? ` ${i18n._(PREVENTIVE_COPY.beingReviewed)}` : ""
    }`,
  };
}

/** Page-level messages for a result (status, missing profile inputs, version). */
export function preventivePageNotes(
  i18n: I18n,
  result: PreventiveCareResult,
): {
  statusText: string | null;
  notes: string[];
  versionText: string;
} {
  const statusText =
    result.status === "no_region"
      ? i18n._(PREVENTIVE_COPY.noRegion)
      : result.status === "adult_confirmation_required"
        ? i18n._(PREVENTIVE_COPY.adultsOnly)
        : result.status === "owner_only"
          ? i18n._(PREVENTIVE_COPY.ownerOnly)
          : null;
  const notes: string[] = [];
  if (result.status === "available") {
    if (result.region)
      notes.push(
        i18n._(PREVENTIVE_COPY.regionLine(i18n._(REGION_AUTHORITY_LABELS[result.region]))),
      );
    if (result.ageUnavailable) notes.push(i18n._(PREVENTIVE_COPY.ageNote(result.ageUnavailable)));
    if (result.sexUnavailable) notes.push(i18n._(PREVENTIVE_COPY.sexNote(result.sexUnavailable)));
    if (result.items.length === 0) notes.push(i18n._(PREVENTIVE_COPY.empty));
  }
  return {
    statusText,
    notes,
    versionText: i18n._(PREVENTIVE_COPY.versionText(result.packVersion, result.asOf)),
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

export const CERTAINTY_LABELS: Record<EvidenceCertainty, MessageDescriptor> = {
  high: msg({ message: "High certainty", comment: "safety" }),
  moderate: msg({ message: "Moderate certainty (“probably”)", comment: "safety" }),
  low: msg({ message: "Low certainty (“may”)", comment: "safety" }),
  very_low: msg({
    message: "Very low certainty (“the evidence is very uncertain”)",
    comment: "safety",
  }),
  not_graded: msg({
    message: "Authority grade or consensus (no certainty rating)",
    comment: "safety",
  }),
};

export const VERDICT_LABELS: Record<EvidenceVerdict, MessageDescriptor> = {
  guideline_backed: msg({ message: "Guideline-backed", comment: "safety" }),
  clinician_decision: msg({
    message: "Clinician decision for specific situations",
    comment: "safety",
  }),
  may_help_slightly: msg({ message: "May help slightly", comment: "safety" }),
  little_or_no_benefit: msg({ message: "Little or no benefit", comment: "safety" }),
  evidence_uncertain: msg({ message: "Evidence uncertain", comment: "safety" }),
  not_recommended: msg({
    message: "Not recommended without a specific reason",
    comment: "safety",
  }),
  investigational: msg({ message: "Investigational", comment: "safety" }),
};

export const LIBRARY_COPY = {
  title: msg`Evidence check`,
  intro: msg({
    message:
      "How popular longevity practices and tests hold up in published trials and guidelines. For information only: no doses, no reminders, and not personal medical advice. Most trial participants were 50 or older, so results apply less directly to younger adults. Talk to your clinician before starting or stopping anything.",
    comment: "safety",
  }),
  off: msg`The evidence-check library is off. Turn it on in the preventive-care settings to see it.`,
  needsCheck: msg`Source taken from the project's research brief; awaiting a maintainer check.`,
} as const satisfies Record<string, MessageDescriptor>;

export type EvidenceEntryCard = {
  key: string;
  title: string;
  verdictLabel: string;
  certaintyLabel: string;
  lines: string[];
  sources: { citation: string; url: string; note: string | null }[];
};

/** One library entry, labels in the language of `i18n`; the entry's own text as published. */
export function evidenceEntryCard(i18n: I18n, entry: EvidenceEntry): EvidenceEntryCard {
  const { harms, cautions } = entry;
  return {
    key: entry.id,
    title: entry.title,
    verdictLabel: i18n._(VERDICT_LABELS[entry.verdict]),
    certaintyLabel: i18n._(CERTAINTY_LABELS[entry.certainty]),
    lines: [
      entry.summary,
      ...(harms ? [i18n._(msg({ message: `Harms: ${harms}`, comment: "safety" }))] : []),
      ...(cautions ? [i18n._(msg({ message: `Take care: ${cautions}`, comment: "safety" }))] : []),
    ],
    sources: entry.sources.map((source) => ({
      citation: source.citation,
      url: source.url,
      note: source.verification === "from_research_brief" ? i18n._(LIBRARY_COPY.needsCheck) : null,
    })),
  };
}
