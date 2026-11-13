import { useLingui } from "@lingui/react/macro";
import { browserTimeZone } from "@openvalens/api/presenters/tracker-draft";
import { formatTrackerValue, parseTrackerInput } from "@openvalens/api/presenters/trackers";
import {
  findTrackerTemplate,
  TRACKER_LIMITS,
  type TrackerTemplateId,
  type TrackerType,
} from "@openvalens/trackers/model";
import { useMutation } from "@tanstack/react-query";
import { Button, useToast } from "heroui-native";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { orpc } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

import { TRACKER_INPUT_CLASS, TrackerValueInput } from "./tracker-value-input";

export type LoggableTracker = {
  id: string;
  name: string;
  type: TrackerType;
  unit: string | null;
  decimals: number;
  template: TrackerTemplateId | null;
};

/**
 * Logs one entry into a custom tracker (#441), now, with an optional note.
 * Several entries a day combine by the tracker's rule. Saves at once and
 * offers an undo.
 */
export function TrackerLogForm({
  tracker,
  onLogged,
}: {
  tracker: LoggableTracker;
  onLogged: () => void;
}) {
  const { t, i18n } = useLingui();
  const { toast } = useToast();
  const placeholder = useThemeColor("ink-3");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(
    () => findTrackerTemplate(tracker.template)?.promptsNote === true,
  );
  const [touched, setTouched] = useState(false);
  const value = parseTrackerInput(tracker, text, i18n.locale);
  const undo = useMutation({
    mutationFn: (id: string) => orpc.trackers.deleteEntry.call({ id }),
    onSuccess: onLogged,
  });
  const save = useMutation({
    mutationFn: () =>
      orpc.trackers.log.call({
        trackerId: tracker.id,
        value: value!,
        timeZone: browserTimeZone(),
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    onSuccess: (entry) => {
      setText("");
      setNote("");
      setTouched(false);
      onLogged();
      const logged = formatTrackerValue(i18n, tracker, entry.value);
      toast.show({
        variant: "success",
        label: t`Logged ${logged}.`,
        actionLabel: t`Undo`,
        onActionPress: ({ hide }) => {
          undo.mutate(entry.id);
          hide();
        },
      });
    },
    onError: (error) =>
      toast.show({
        variant: "danger",
        label: error instanceof Error ? error.message : t`Could not save. Try again.`,
      }),
  });
  const valueLabel = t`Value for ${tracker.name}`;
  return (
    <View className="gap-3">
      <TrackerValueInput
        label={valueLabel}
        type={tracker.type}
        unit={tracker.unit}
        template={tracker.template}
        text={text}
        onText={setText}
        testID={`tracker-value-${tracker.id}`}
      />
      {touched && value === null ? (
        <Text accessibilityRole="alert" className="font-sans text-sm text-destructive">
          {tracker.type === "duration"
            ? t`Enter a duration such as 20 min, 1:30 or 45 s.`
            : tracker.type === "number"
              ? t`Enter a number.`
              : t`Choose a value.`}
        </Text>
      ) : null}
      {showNote ? (
        <TextInput
          accessibilityLabel={t`Note (optional)`}
          placeholder={t`Note (optional)`}
          placeholderTextColor={placeholder}
          value={note}
          maxLength={TRACKER_LIMITS.noteLength}
          onChangeText={setNote}
          multiline
          className={TRACKER_INPUT_CLASS}
        />
      ) : null}
      <View className="flex-row flex-wrap gap-2">
        <Button
          size="sm"
          isDisabled={save.isPending}
          onPress={() => {
            setTouched(true);
            if (value !== null) save.mutate();
          }}
        >
          <Button.Label>{save.isPending ? t`Saving…` : t`Log`}</Button.Label>
        </Button>
        {!showNote ? (
          <Button size="sm" variant="ghost" onPress={() => setShowNote(true)}>
            <Button.Label>{t`Add a note`}</Button.Label>
          </Button>
        ) : null}
      </View>
    </View>
  );
}
