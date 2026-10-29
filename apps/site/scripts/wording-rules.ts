/**
 * Banned marketing terms from "Legal and clinical gate decisions" (decision
 * 10). The intended-purpose statement is the one place some of them appear —
 * as negations — so it is removed before scanning. Shared by the landing
 * site and the store listings (`apps/native/store`, #307).
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
  /longevity/i,
  /optimi[sz]e your/i,
  /\breverse\b/i,
  /HIPAA/i,
  /GDPR[- ]certified/i,
  /we never share/i,
];

/** Allowed exact phrases that contain a banned term (gate decisions, "Allowed"). */
export const ALLOWED_PHRASES = [/It is not medical advice and can be wrong\./g];
