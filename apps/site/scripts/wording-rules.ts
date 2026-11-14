/**
 * Banned marketing terms from "Legal and clinical gate decisions" (decision
 * 10), extended with the claims checklist of Issue #445. The intended-purpose
 * statement is the one place some of them appear — as negations — so it is
 * removed before scanning. Shared by the landing site and the store listings
 * (`apps/native/store`, #307).
 *
 * The #445 checklist, reviewed against the intended-purpose statement before
 * each publish: no "improve your health", "detect", "monitor conditions" or
 * "prevent"; insights are "what changed in your records"; labs copy says "keep
 * and compare your results", never "understand what's wrong"; no claim that
 * other companies sell data.
 */
export const BANNED_TERMS = [
  /\bdiagnos/i,
  /\bdetect/i,
  /\bscreen for\b/i,
  /\bpredict/i,
  /\binterpret/i,
  /\btreat/i,
  /\bcure/i,
  /early warning/i,
  /\bcatch .* early\b/i,
  /(clinical|medical)[- ]grade/i,
  /clinically (validated|proven)/i,
  /doctor[- ]approved/i,
  /\bFDA\b/,
  /CE[- ]marked/i,
  /\babnormal/i,
  /\bat risk\b/i,
  /risk score/i,
  /biological age/i,
  /AI (doctor|clinician)/i,
  /medical advice/i,
  /personali[sz]ed medical/i,
  /improves? your health/i,
  /\bimprov(e|es|ing) (your )?(health|wellbeing|well-being)/i,
  /\bhealthier\b/i,
  /\bmonitor/i,
  /\bprevent(s|ed|ing|ion)?\b/i,
  /what'?s wrong/i,
  /\bunderstand (your|what)/i,
  /\bsell(s|ing)?\b.{0,40}\bdata\b/i,
  /longevity/i,
  /optimi[sz]e your/i,
  /\breverse\b/i,
  /HIPAA/i,
  /GDPR[- ]certified/i,
  /we never share/i,
];

/** Allowed exact phrases that contain a banned term (gate decisions, "Allowed"). */
export const ALLOWED_PHRASES = [
  /It is not medical advice and can be wrong\./g,
  // The FAQ question the #445 design names; its answer is "No."
  /Is it medical advice\?/g,
  // Device and tool names, not health claims.
  /\bBlood Pressure Monitor\b/g,
  /\buptime monitors\b/g,
];

/**
 * Competitors are never named (#445): only a generic "closed apps /
 * OpenValens" contrast. Assembled from parts so this file does not name one
 * either. Matched case-insensitively, also inside domains.
 */
export const COMPETITOR_NAMES: readonly string[] = [["health", "maxx"].join("")];
