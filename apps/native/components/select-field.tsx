import { useLingui } from "@lingui/react/macro";
import { Select } from "heroui-native";

export type SelectFieldOption<V extends string> = { value: V; label: string; testID?: string };

/**
 * A single choice as a dropdown (heroui's Select, opening under the field at
 * its width), in place of a row of pills. Picking the current choice again
 * keeps it.
 */
export function SelectField<V extends string>({
  options,
  value,
  onChange,
  accessibilityLabel,
  placeholder,
  testID,
}: {
  options: readonly SelectFieldOption<V>[];
  value: V | undefined;
  onChange: (next: V) => void;
  accessibilityLabel: string;
  placeholder?: string;
  testID?: string;
}) {
  const { t } = useLingui();
  const selected = options.find((option) => option.value === value);
  return (
    <Select
      value={selected ? { value: selected.value, label: selected.label } : undefined}
      onValueChange={(next) => {
        if (!next || Array.isArray(next) || next.value === value) return;
        const option = options.find((candidate) => candidate.value === next.value);
        if (option) onChange(option.value);
      }}
    >
      <Select.Trigger testID={testID} accessibilityLabel={accessibilityLabel}>
        <Select.Value placeholder={placeholder ?? t`Choose…`} />
        <Select.TriggerIndicator />
      </Select.Trigger>
      <Select.Portal>
        <Select.Overlay />
        <Select.Content presentation="popover" width="trigger">
          {options.map((option) => (
            <Select.Item
              key={option.value}
              value={option.value}
              label={option.label}
              testID={option.testID}
            />
          ))}
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}
