import type { MessageDescriptor } from "@lingui/core";

import { createAppI18n } from "./index";

/**
 * English rendering for tests and other non-UI callers (#67): presenters
 * return message descriptors, and tests assert the English text.
 */
export const englishI18n = createAppI18n("en");

export function inEnglish(message: MessageDescriptor): string {
  return englishI18n._(message);
}
