import { DEMO_READ_ONLY_MESSAGE } from "@openvalens/auth/demo";

import { procedureAccessClass } from "./access-policy";
import { raiseApiError } from "./errors";

const DEMO_READS = new Set([
  "access.status",
  "healthConsent.status",
  "signIn.options",
  "signUp.options",
  "admission.status",
  "billing.status",
  "adminSettings.access",
  "adminSettings.productSettings",
]);

/** Unlike ended subscriptions, demo visitors cannot export, delete or change consent. */
export function allowedInDemo(path: readonly string[]): boolean {
  return procedureAccessClass(path) === "read" || DEMO_READS.has(path.join("."));
}

export function requireDemoReadOnly(isDemo: boolean | undefined, path: readonly string[]) {
  if (isDemo && !allowedInDemo(path)) throw raiseApiError("DEMO_READ_ONLY", DEMO_READ_ONLY_MESSAGE);
}
