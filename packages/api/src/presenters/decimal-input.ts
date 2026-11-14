import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { ambiguousDecimal } from "@openvalens/i18n/numbers";

/**
 * The message for a typed number that reads two ways (#455). `"2,000"` is
 * 2000 with a thousands comma and 2 with a decimal comma, so `parseDecimal`
 * refuses it rather than guess. This names both readings and asks the member
 * to type the one they mean. `null` when `raw` is not that case, so a form
 * can fall back to its own message.
 */
export function ambiguousDecimalMessage(raw: string, locale?: string): MessageDescriptor | null {
  const readings = ambiguousDecimal(raw, locale);
  if (!readings) return null;
  const { typed, whole, decimal } = readings;
  return msg`“${typed}” could mean ${whole} or ${decimal}. Type ${whole} or ${decimal}, whichever you mean.`;
}
