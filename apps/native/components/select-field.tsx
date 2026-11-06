import { useLingui } from "@lingui/react/macro";
import { cn } from "heroui-native";
import { Check, ChevronDown } from "lucide-react-native";
import { useState } from "react";
import { Modal, Pressable, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "@/components/bloom";

export type SelectFieldOption<V extends string> = { value: V; label: string; testID?: string };

/**
 * A single choice as a dropdown, in place of a row of pills: a field that
 * opens the options in a sheet from the bottom. A React Native Modal, not a
 * portal, so VoiceOver and the e2e flows reach the options. Picking the
 * current choice again keeps it.
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
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);

  const pick = (next: V) => {
    setOpen(false);
    if (next !== value) onChange(next);
  };

  return (
    <>
      <Pressable
        testID={testID}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: selected?.label ?? placeholder ?? t`Choose…` }}
        accessibilityState={{ expanded: open }}
        className="min-h-12 flex-row items-center gap-2 rounded-2xl border border-rule-2 bg-sheet px-4 active:opacity-70"
      >
        <Text
          numberOfLines={1}
          className={cn("flex-1 font-sans text-base", selected ? "text-ink" : "text-ink-3")}
        >
          {selected?.label ?? placeholder ?? t`Choose…`}
        </Text>
        <Icon icon={ChevronDown} size={18} color="ink-2" />
      </Pressable>
      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
        statusBarTranslucent
      >
        <View className="flex-1 justify-end">
          <Pressable
            className="absolute inset-0 bg-black/40"
            onPress={() => setOpen(false)}
            accessibilityRole="button"
            accessibilityLabel={t`Close`}
          />
          <View
            className="max-h-[70%] rounded-t-[28px] bg-sheet px-4 pt-4"
            style={{ paddingBottom: insets.bottom + 12 }}
          >
            <Text
              className="px-2 pb-2 font-display text-lg font-semibold text-ink"
              accessibilityRole="header"
            >
              {accessibilityLabel}
            </Text>
            <ScrollView accessibilityRole="radiogroup">
              {options.map((option) => {
                const isSelected = option.value === value;
                return (
                  <Pressable
                    key={option.value}
                    testID={option.testID}
                    onPress={() => pick(option.value)}
                    accessibilityRole="radio"
                    accessibilityState={{ checked: isSelected, selected: isSelected }}
                    className={cn(
                      "min-h-12 flex-row items-center gap-3 rounded-2xl px-3 active:opacity-70",
                      isSelected && "bg-sidebar-accent",
                    )}
                  >
                    <Text
                      className={cn(
                        "flex-1 font-sans text-base",
                        isSelected ? "font-semibold text-ink" : "text-ink-2",
                      )}
                    >
                      {option.label}
                    </Text>
                    {isSelected ? <Icon icon={Check} size={18} color="signal" /> : null}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}
