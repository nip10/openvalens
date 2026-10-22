import { CYCLE_COPY } from "@openvalens/api/presenters/cycle";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Spinner } from "heroui-native";
import { useState } from "react";
import { Alert, Pressable, Switch, Text, TextInput, View } from "react-native";

import { CardStack } from "@/components/list-row";
import { Container } from "@/components/container";
import { authClient } from "@/lib/auth-client";
import { client } from "@/utils/orpc";

/**
 * Optional cycle logging (#91) on mobile. Off until the member accepts its
 * own consent; estimates only, never ovulation or fertility predictions, and
 * no change to nutrition targets.
 */

const FLOWS = ["spotting", "light", "medium", "heavy"] as const;
const INPUT =
  "min-h-11 rounded-lg border border-border bg-card px-3 py-2 text-base text-foreground";
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function localToday(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

export default function CycleScreen() {
  const { data: session, isPending } = authClient.useSession();
  const scope =
    session?.user?.id && session.session.activeOrganizationId
      ? `${session.session.activeOrganizationId}:${session.user.id}`
      : null;
  if (isPending || !scope)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        {isPending ? <Spinner /> : <Text className="text-foreground">Choose a workspace.</Text>}
      </Container>
    );
  return <CycleForMember key={scope} scope={scope} />;
}

function CycleForMember({ scope }: { scope: string }) {
  const qc = useQueryClient();
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
      setNotice("Period saved.");
      refresh();
    },
    onError: () => setNotice("Could not save. Use YYYY-MM-DD dates and try again."),
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
      "Erase all cycle data?",
      "Every period and import is deleted and your consent is withdrawn. This cannot be undone.",
      [
        { text: "Keep my data", style: "cancel" },
        { text: "Erase", style: "destructive", onPress: () => erase.mutate() },
      ],
    );

  if (settings.isPending)
    return (
      <Container className="items-center justify-center" isScrollable={false}>
        <Spinner />
      </Container>
    );

  return (
    <Container className="p-4">
      <View className="gap-6">
        <View>
          <Text accessibilityRole="header" className="font-mono text-3xl text-foreground">
            Cycle
          </Text>
          <Text className="mt-2 text-sm text-muted-foreground">
            {CYCLE_COPY.notForContraception}
          </Text>
        </View>
        {settings.isError ? (
          <Button variant="secondary" onPress={() => void settings.refetch()}>
            Could not check this setting. Try again
          </Button>
        ) : !enabled ? (
          <CardStack title="Cycle logging is off">
            <Card variant="secondary" className="gap-3 p-4">
              <Text className="text-sm text-foreground">{CYCLE_COPY.consentText}</Text>
              <View className="flex-row items-center justify-between gap-3">
                <Text className="flex-1 text-sm text-foreground">
                  I agree to store my cycle data on this server for my own reference.
                </Text>
                <Switch
                  value={agreed}
                  onValueChange={setAgreed}
                  accessibilityLabel="Agree to store cycle data"
                />
              </View>
              <Button isDisabled={!agreed || enable.isPending} onPress={() => enable.mutate()}>
                {enable.isPending ? "Turning on…" : "Turn on cycle logging"}
              </Button>
            </Card>
          </CardStack>
        ) : (
          <>
            <CardStack title="Estimates">
              <Card variant="secondary" className="gap-2 p-4">
                {estimates.data?.state === "off" ? (
                  <Text className="text-sm text-foreground">{CYCLE_COPY.noNaturalCycle}</Text>
                ) : estimates.data?.state === "estimated" ? (
                  <>
                    {estimates.data.current ? (
                      <Text className="text-sm text-foreground">
                        Day {estimates.data.current.dayOfCycle} of the current cycle.{" "}
                        {CYCLE_COPY.currentLowConfidence}
                      </Text>
                    ) : null}
                    {estimates.data.cycles
                      .filter((cycle) => cycle.lutealEstimate)
                      .slice(0, 3)
                      .map((cycle) => (
                        <Text key={cycle.startDate} className="text-sm text-muted-foreground">
                          {cycle.startDate} · {cycle.lengthDays} days · {CYCLE_COPY.lutealLabel}:{" "}
                          {cycle.lutealEstimate!.from} to {cycle.lutealEstimate!.to}
                        </Text>
                      ))}
                  </>
                ) : (
                  <Text className="text-sm text-muted-foreground">
                    Log a period to see your cycle history.
                  </Text>
                )}
                <View className="flex-row items-center justify-between gap-3">
                  <Text className="flex-1 text-sm text-foreground">
                    Hormonal contraception or no natural cycle (turns estimates off)
                  </Text>
                  <Switch
                    value={settings.data.noNaturalCycle}
                    onValueChange={(value) => updateSettings.mutate(value)}
                    accessibilityLabel="Hormonal contraception or no natural cycle"
                  />
                </View>
              </Card>
            </CardStack>

            <CardStack title="Log a period">
              <Card variant="secondary" className="gap-3 p-4">
                <TextInput
                  value={startDate}
                  onChangeText={setStartDate}
                  placeholder="Start date (YYYY-MM-DD)"
                  accessibilityLabel="Start date, YYYY-MM-DD"
                  className={INPUT}
                  placeholderTextColor="#9ca3af"
                />
                <TextInput
                  value={endDate}
                  onChangeText={setEndDate}
                  placeholder="End date, optional (YYYY-MM-DD)"
                  accessibilityLabel="End date, optional, YYYY-MM-DD"
                  className={INPUT}
                  placeholderTextColor="#9ca3af"
                />
                <View className="flex-row flex-wrap gap-2">
                  {FLOWS.map((value) => (
                    <Pressable
                      key={value}
                      onPress={() => setFlow(flow === value ? null : value)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: flow === value }}
                      className={`min-h-11 justify-center rounded-lg border px-3 ${flow === value ? "bg-accent" : "border-border"}`}
                    >
                      <Text className="text-sm text-foreground">{value}</Text>
                    </Pressable>
                  ))}
                </View>
                <Button
                  isDisabled={
                    !DATE.test(startDate) || (!!endDate && !DATE.test(endDate)) || log.isPending
                  }
                  onPress={() => log.mutate()}
                >
                  {log.isPending ? "Saving…" : "Save period"}
                </Button>
              </Card>
            </CardStack>

            <CardStack title="History">
              <Card variant="secondary" className="gap-2 p-4">
                {periods.data?.length ? (
                  periods.data.map((period) => (
                    <View key={period.id} className="flex-row items-center justify-between gap-2">
                      <Text className="flex-1 text-sm text-foreground">
                        {period.startDate}
                        {period.endDate ? ` to ${period.endDate}` : ""}
                        {period.flow ? ` · ${period.flow}` : ""}
                        {period.source !== "manual" ? " · imported" : ""}
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        onPress={() => remove.mutate(period.id)}
                        className="min-h-11 justify-center px-2"
                      >
                        <Text className="text-foreground underline">Delete</Text>
                      </Pressable>
                    </View>
                  ))
                ) : (
                  <Text className="text-sm text-muted-foreground">No periods logged yet.</Text>
                )}
              </Card>
            </CardStack>

            <Button variant="secondary" isDisabled={erase.isPending} onPress={confirmErase}>
              Turn off and erase
            </Button>
          </>
        )}
        {notice ? (
          <Text accessibilityLiveRegion="polite" className="text-sm text-muted-foreground">
            {notice}
          </Text>
        ) : null}
      </View>
    </Container>
  );
}
