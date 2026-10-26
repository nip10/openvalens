/**
 * Client-safe cycle copy (Issue #91), shared by the web and native screens.
 *
 * The English source of truth is `CYCLE_COPY` in `@openvalens/body`, which
 * the server also reads (for the consent version). Here the same text is a
 * set of Lingui message descriptors (#67); `cycle.test.ts` keeps the two in
 * step. The disclaimer and consent text are tagged `safety`, so a community
 * translation shows them in English until a reviewer approves them.
 */
import { msg } from "@lingui/core/macro";
import { CYCLE_COPY as CYCLE_SOURCE } from "@openvalens/body/cycle-estimates";

export const CYCLE_COPY = Object.freeze({
  estimateLabel: msg`Estimate`,
  lutealLabel: msg({
    message: "Estimated luteal phase (about the last 12 to 14 days before your period)",
    comment: "safety",
  }),
  currentLowConfidence: msg({
    message:
      "Estimated, low confidence. A phase can only be estimated once your next period is logged.",
    comment: "safety",
  }),
  noNaturalCycle: msg({
    message:
      "Phase estimates are off because you said you use hormonal contraception or have no natural cycle.",
    comment: "safety",
  }),
  notForContraception: msg({
    message:
      "For your own reference only. This is not a contraception or fertility tool and does not change your nutrition targets.",
    comment: "safety",
  }),
  /** Not shown: the version the server checks consent against. */
  consentVersion: CYCLE_SOURCE.consentVersion,
  consentText: msg({
    message:
      "Cycle logging is optional and separate from everything else. Your cycle data stays private to you: workspace owners and other members cannot see it, and it is left out of AI and coach features, clinical exports, Telegram, email and analytics. You can turn it off and erase it at any time.",
    comment: "safety",
  }),
});
