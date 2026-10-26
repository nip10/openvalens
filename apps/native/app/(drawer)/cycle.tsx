import type { MessageDescriptor } from "@lingui/core";
import { msg, plural } from "@lingui/core/macro";
import { useLingui } from "@lingui/react/macro";
import { CYCLE_COPY } from "@openvalens/api/presenters/cycle";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Spinner } from "heroui-native";
import { CalendarHeart, Droplet, History, Lock, Plus } from "lucide-react-native";
import { useState } from "react";
import { Alert, Pressable, Switch, Text, TextInput, View } from "react-native";

import {
  Details,
  EmptyState,
  ErrorState,
  Icon,
  InfoTip,
  ListCard,
  Page,
  PageHeader,
  Prose,
  Section,
  Sheet,
  StatusPill,
  ToneChip,
  ToneIcon,
} from "@/components/bloom";
import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import { friendlyDate } from "@/utils/friendly";
import { client } from "@/utils/orpc";
import { useThemeColor } from "@/utils/theme";

/**
 * Optional cycle logging (#91) on mobile. Off until the member accepts its
 * own consent; estimates only, never ovulation or fertility predictions, and
 * no change to nutrition targets.
 */

const FLOWS = ["spotting", "light", "medium", "heavy"] as const;
const FLOW_LABELS: Record<(typeof FLOWS)[number], MessageDescriptor> = {
  spotting: msg`Spotting`,
  light: msg({ message: "Light", context: "period flow" }),
  medium: msg`Medium`,
  heavy: msg`Heavy`,
};
const INPUT =
  "min-h-11 rounded-xl border border-rule-2 bg-sheet px-3 py-2 font-sans text-base text-ink";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function localToday(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

export default function CycleScreen() {
  const { data: session, isPending } = authClient.useSession();
  const { t } = useLingui();
  const scope =
    session?.user?.id && session.session.activeOrganizationId
      ? `${session.session.activeOrganizationId}:${session.user.id}`
      : null;
  if (isPending || !scope)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        {isPending ? (
          <Spinner />
        ) : (
          <Text className="font-sans text-base text-ink-2">{t`Choose a workspace.`}</Text>
        )}
      </Container>
    );
  return <CycleForMember key={scope} scope={scope} />;
}

function CycleForMember({ scope }: { scope: string }) {
  const qc = useQueryClient();
  const { t, i18n } = useLingui();
  const placeholder = useThemeColor("ink-3");
  const flowLabel = (value: string) => {
    const known = FLOW_LABELS[value as (typeof FLOWS)[number]];
    return known ? i18n._(known) : value;
  };
  const refresh = () => void qc.invalidateQueries({ queryKey: ["cycle"] });
  const today = localToday();
  const settings = useQuery({
    queryKey: ["cycle", "settings", scope],
    queryFn: () => client.cycle.settings({}),
  });
  const enabled = settings.data?.enabled === true;
  const periods = useQuery({
    queryKey: ["cycle", "periods", scope],
    queryFn: () => client.cycle.periods({}),
    enabled,
  });
  const estimates = useQuery({
    queryKey: ["cycle", "estimates", scope, today],
    queryFn: () => client.cycle.estimates({ today }),
    enabled,
  });
  const [agreed, setAgreed] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState("");
  const [flow, setFlow] = useState<(typeof FLOWS)[number] | null>(null);
  const [notice, setNotice] = useState("");

  const enable = useMutation({
    mutationFn: () =>
      client.cycle.enable({ consent: true, consentVersion: CYCLE_COPY.consentVersion }),
    onSuccess: refresh,
  });
  const log = useMutation({
    mutationFn: () => client.cycle.logPeriod({ startDate, endDate: endDate || null, flow }),
    onSuccess: () => {
      setEndDate("");
      setFlow(null);
      setNotice(t`Period saved.`);
      refresh();
    },
    onError: () => setNotice(t`Could not save. Use YYYY-MM-DD dates and try again.`),
  });
  const remove = useMutation({
    mutationFn: (id: string) => client.cycle.deletePeriod({ id }),
    onSuccess: refresh,
  });
  const updateSettings = useMutation({
    mutationFn: (value: boolean) => client.cycle.updateSettings({ noNaturalCycle: value }),
    onSuccess: refresh,
  });
  const erase = useMutation({
    mutationFn: () => client.cycle.turnOffAndErase({ confirm: true }),
    onSuccess: refresh,
  });
  const confirmErase = () =>
    Alert.alert(
      t`Erase all cycle data?`,
      t({
        message:
          "Every period and import is deleted and your consent is withdrawn. This cannot be undone.",
        comment: "safety",
      }),
      [
        { text: t`Keep my data`, style: "cancel" },
        { text: t`Erase`, style: "destructive", onPress: () => erase.mutate() },
      ],
    );

  const estimated = estimates.data?.state === "estimated" ? estimates.data : null;
  const current = estimated?.current ?? null;
  const lutealCycles = estimated?.cycles.filter((cycle) => cycle.lutealEstimate).slice(0, 3) ?? [];

  return (
    <Container>
      <Page>
        <PageHeader title={t`Cycle`} description={i18n._(CYCLE_COPY.notForContraception)} />
        {settings.isPending ? (
          <Sheet className="h-40 items-center justify-center">
            <Spinner />
          </Sheet>
        ) : settings.isError ? (
          <ErrorState
            title={t`Could not check this setting. Try again`}
            action={
              <Button variant="outline" size="sm" onPress={() => void settings.refetch()}>
                {t`Try again`}
              </Button>
            }
          />
        ) : !enabled ? (
          <Section icon={Lock} tone="heart" title={t`Cycle logging is off`} sheet>
            <Text className="font-sans text-base leading-relaxed text-ink-2">
              {i18n._(CYCLE_COPY.consentText)}
            </Text>
            <View className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 font-sans text-sm text-ink-2">
                {t({
                  message: "I agree to store my cycle data on this server for my own reference.",
                  comment: "safety",
                })}
              </Text>
              <Switch
                value={agreed}
                onValueChange={setAgreed}
                accessibilityLabel={t({
                  message: "Agree to store cycle data",
                  comment: "safety",
                })}
              />
            </View>
            <Button isDisabled={!agreed || enable.isPending} onPress={() => enable.mutate()}>
              {enable.isPending ? t`Turning on…` : t`Turn on cycle logging`}
            </Button>
          </Section>
        ) : (
          <>
            <Sheet className="gap-4">
              <View className="flex-row items-center gap-2.5">
                <ToneIcon icon={CalendarHeart} tone="heart" />
                <Text
                  accessibilityRole="header"
                  className="font-sans text-base font-semibold text-ink-2"
                >
                  {t`Estimates`}
                </Text>
              </View>
              {estimates.data?.state === "off" ? (
                <Text className="font-sans text-base text-ink-2">
                  {i18n._(CYCLE_COPY.noNaturalCycle)}
                </Text>
              ) : current ? (
                <View className="gap-2">
                  <Text
                    className="font-display text-[48px] font-medium leading-[54px] text-ink"
                    style={{ fontVariant: ["tabular-nums"] }}
                  >
                    {t`Day ${current.dayOfCycle}`}
                  </Text>
                  <View className="flex-row flex-wrap items-center gap-2">
                    <StatusPill tone="neutral">{i18n._(CYCLE_COPY.estimateLabel)}</StatusPill>
                    <Text className="font-sans text-sm text-ink-3">
                      {t`Started ${friendlyDate(i18n, current.startDate)}`}
                    </Text>
                    <InfoTip>
                      <Prose>
                        {t`Day ${current.dayOfCycle} of the current cycle.`}{" "}
                        {i18n._(CYCLE_COPY.currentLowConfidence)}
                      </Prose>
                    </InfoTip>
                  </View>
                </View>
              ) : estimates.isPending ? (
                <Text className="font-sans text-sm text-ink-3">{t`Loading…`}</Text>
              ) : (
                <Text className="font-sans text-base text-ink-3">
                  {t`Log a period to see your cycle history.`}
                </Text>
              )}
              <View className="flex-row items-center justify-between gap-3 border-t border-rule pt-4">
                <Text className="flex-1 font-sans text-sm text-ink-2">
                  {t({
                    message: "Hormonal contraception or no natural cycle (turns estimates off)",
                    comment: "safety",
                  })}
                </Text>
                <Switch
                  value={settings.data.noNaturalCycle}
                  onValueChange={(value) => updateSettings.mutate(value)}
                  accessibilityLabel={t({
                    message: "Hormonal contraception or no natural cycle",
                    comment: "safety",
                  })}
                />
              </View>
            </Sheet>

            <Section icon={Plus} tone="heart" title={t`Log a period`} sheet>
              <TextInput
                value={startDate}
                onChangeText={setStartDate}
                placeholder={t`Start date (YYYY-MM-DD)`}
                accessibilityLabel={t`Start date, YYYY-MM-DD`}
                className={INPUT}
                placeholderTextColor={placeholder}
              />
              <TextInput
                value={endDate}
                onChangeText={setEndDate}
                placeholder={t`End date, optional (YYYY-MM-DD)`}
                accessibilityLabel={t`End date, optional, YYYY-MM-DD`}
                className={INPUT}
                placeholderTextColor={placeholder}
              />
              <View className="flex-row flex-wrap gap-2">
                {FLOWS.map((value) => (
                  <Pressable
                    key={value}
                    onPress={() => setFlow(flow === value ? null : value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: flow === value }}
                    className={`min-h-11 flex-row items-center gap-1.5 rounded-full border px-4 ${flow === value ? "border-heart bg-heart-soft" : "border-rule-2 bg-sheet"}`}
                  >
                    <Icon icon={Droplet} size={14} color={flow === value ? "heart" : "ink-3"} />
                    <Text
                      className={`font-sans text-sm ${flow === value ? "font-semibold text-ink" : "text-ink-2"}`}
                    >
                      {flowLabel(value)}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Button
                isDisabled={
                  !DATE.test(startDate) || (!!endDate && !DATE.test(endDate)) || log.isPending
                }
                onPress={() => log.mutate()}
              >
                {log.isPending ? t`Saving…` : t`Save period`}
              </Button>
            </Section>

            <Details summary={t`History`}>
              <View className="gap-3">
                {lutealCycles.length ? (
                  <Sheet className="px-4 py-1">
                    {lutealCycles.map((cycle, index) => {
                      const luteal = i18n._(CYCLE_COPY.lutealLabel);
                      const from = cycle.lutealEstimate!.from;
                      const to = cycle.lutealEstimate!.to;
                      return (
                        <View
                          key={cycle.startDate}
                          className={`gap-1 py-3 ${index < lutealCycles.length - 1 ? "border-b border-rule" : ""}`}
                        >
                          <View className="flex-row items-center justify-between gap-2">
                            <Text className="font-sans text-base text-ink">{cycle.startDate}</Text>
                            <ToneChip tone="heart">
                              {t`${plural(cycle.lengthDays ?? 0, { one: "# day", other: "# days" })}`}
                            </ToneChip>
                          </View>
                          <Text className="font-sans text-sm text-ink-3">
                            {t`${luteal}: ${from} to ${to}`}
                          </Text>
                        </View>
                      );
                    })}
                  </Sheet>
                ) : null}
                {periods.data?.length ? (
                  periods.data.map((period) => (
                    <ListCard
                      key={period.id}
                      icon={Droplet}
                      tone="heart"
                      title={
                        period.endDate
                          ? t`${period.startDate} to ${period.endDate}`
                          : period.startDate
                      }
                      subtitle={
                        [
                          period.flow ? flowLabel(period.flow) : "",
                          period.source !== "manual" ? t`imported` : "",
                        ]
                          .filter(Boolean)
                          .join(" · ") || undefined
                      }
                      trailing={
                        <Button
                          size="sm"
                          variant="ghost"
                          accessibilityRole="button"
                          onPress={() => remove.mutate(period.id)}
                        >
                          {t`Delete`}
                        </Button>
                      }
                    />
                  ))
                ) : (
                  <EmptyState icon={History} tone="heart" title={t`No periods logged yet.`} />
                )}
              </View>
            </Details>

            <Button variant="secondary" isDisabled={erase.isPending} onPress={confirmErase}>
              {t`Turn off and erase`}
            </Button>
          </>
        )}
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="font-sans text-sm text-ink-3">
            {notice}
          </Text>
        ) : null}
      </Page>
    </Container>
  );
}
