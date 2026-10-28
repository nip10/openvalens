import type { AmountUnit, MealSlot } from "@openvalens/api/contracts/nutrition-diary";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "heroui-native";

import { NutritionDatePicker } from "@/components/nutrition-date-picker";
import { Sheet } from "@/components/bloom";

export function NutritionEntryEditor({
  visible,
  name,
  amount,
  unit,
  slot,
  localDate,
  units,
  hideNumbers,
  preview,
  labels,
  slotLabels,
  onAmount,
  onUnit,
  onSlot,
  onDate,
  onSave,
  onDelete,
  onFavorite,
  onClose,
}: {
  visible: boolean;
  name: string;
  amount: string;
  unit: AmountUnit;
  slot: MealSlot;
  localDate: string;
  units: AmountUnit[];
  hideNumbers: boolean;
  preview: string;
  labels: {
    close: string;
    amount: string;
    hidden: string;
    date: string;
    favorite: string;
    delete: string;
    save: string;
    unitUnavailable: string;
  };
  slotLabels: Record<MealSlot, string>;
  onAmount: (value: string) => void;
  onUnit: (value: AmountUnit) => void;
  onSlot: (value: MealSlot) => void;
  onDate: (value: string) => void;
  onSave: () => void;
  onDelete: () => void;
  onFavorite?: () => void;
  onClose: () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="overFullScreen"
    >
      <KeyboardAvoidingView
        className="flex-1 justify-end bg-black/40"
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <Sheet
          className="max-h-[90%] gap-3 rounded-b-none px-4 pt-4"
          style={{ paddingBottom: Math.max(insets.bottom, 16) }}
        >
          <View className="flex-row items-center justify-between gap-3">
            <Text className="flex-1 font-display text-xl font-semibold text-ink">{name}</Text>
            <Button variant="ghost" className="min-h-11" onPress={onClose}>
              <Button.Label>{labels.close}</Button.Label>
            </Button>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerClassName="gap-3 pb-2">
            <TextInput
              value={hideNumbers ? "" : amount}
              editable={!hideNumbers}
              onChangeText={(v) => {
                if (!hideNumbers) onAmount(v);
              }}
              keyboardType="decimal-pad"
              accessibilityLabel={hideNumbers ? labels.hidden : labels.amount}
              placeholder={hideNumbers ? labels.hidden : labels.amount}
              className="min-h-11 rounded-xl border border-rule bg-sheet px-3 text-base text-ink"
            />
            {units.length === 0 ? (
              <Text className="text-sm text-ink-3">{labels.unitUnavailable}</Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              {units.map((u) => (
                <Button
                  key={u}
                  variant={unit === u ? "secondary" : "outline"}
                  className="min-h-11"
                  onPress={() => onUnit(u)}
                >
                  <Button.Label>{u}</Button.Label>
                </Button>
              ))}
            </View>
            <View className="flex-row flex-wrap gap-2">
              {(["breakfast", "lunch", "dinner", "snack", "other"] as const).map((s) => (
                <Button
                  key={s}
                  variant={slot === s ? "secondary" : "outline"}
                  className="min-h-11"
                  onPress={() => onSlot(s)}
                >
                  <Button.Label>{slotLabels[s]}</Button.Label>
                </Button>
              ))}
            </View>
            <NutritionDatePicker value={localDate} onChange={onDate} label={labels.date} />
            <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-2">
              {preview}
            </Text>
            {onFavorite ? (
              <Button variant="outline" className="min-h-11 self-start" onPress={onFavorite}>
                <Button.Label>{labels.favorite}</Button.Label>
              </Button>
            ) : null}
            <View className="flex-row flex-wrap justify-end gap-2">
              <Button variant="outline" className="min-h-11" onPress={onDelete}>
                <Button.Label>{labels.delete}</Button.Label>
              </Button>
              <Button className="min-h-11" onPress={onSave}>
                <Button.Label>{labels.save}</Button.Label>
              </Button>
            </View>
          </ScrollView>
        </Sheet>
      </KeyboardAvoidingView>
    </Modal>
  );
}
