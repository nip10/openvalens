import { useLingui } from "@lingui/react/macro";
import { ambiguousDecimalMessage } from "@openvalens/api/presenters/decimal-input";
import { Text } from "react-native";

/**
 * Under a typed number (#455): when the text reads two ways, such as "2,000"
 * (2000, or 2 with a decimal comma), names both readings and asks which one.
 * Renders nothing otherwise, so a field keeps its own validation.
 */
export function DecimalHint({ value }: { value: string | undefined }) {
  const { i18n } = useLingui();
  const message = value ? ambiguousDecimalMessage(value, i18n.locale) : null;
  if (!message) return null;
  return (
    <Text accessibilityLiveRegion="polite" className="font-sans text-xs text-destructive">
      {i18n._(message)}
    </Text>
  );
}
