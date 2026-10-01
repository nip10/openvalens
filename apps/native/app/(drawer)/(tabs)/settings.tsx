import { Ionicons } from "@expo/vector-icons";
import {
  assertivenessLabel,
  COACH_DISCLAIMER_VALUES,
  COACH_RISK_VALUES,
  COACH_TEMPLATE_VALUES,
  COACH_TONE_VALUES,
  disclaimerLabel,
  riskDescription,
  riskLabel,
  templateDescription,
  templateLabel,
  toneDescription,
  toneLabel,
  type CoachDisclaimerMode,
  type CoachRiskTolerance,
  type CoachTemplateId,
  type CoachTone,
} from "@openhealth/api/presenters/coach-settings";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Chip, useThemeColor } from "heroui-native";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";

import { CardStack, ListRow } from "@/components/list-row";
import { Container } from "@/components/container";
import { HealthSyncSettings } from "@/components/health-sync-settings";
import { useAppTheme } from "@/contexts/app-theme-context";
import { authClient } from "@/lib/auth-client";
import { resetHealthSync } from "@/lib/health-sync";
import { orpc, queryClient } from "@/utils/orpc";

export default function SettingsScreen() {
  const { isDark, toggleTheme } = useAppTheme();
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const { data: session } = authClient.useSession();

  const foreground = useThemeColor("foreground");

  const handleSignOut = async () => {
    await resetHealthSync();
    await authClient.signOut();
    queryClient.clear();
  };

  return (
    <Container className="p-4">
      <View className="gap-6">
        {session?.user && (
          <CardStack title="Account">
            <Card variant="secondary" className="p-4">
              <Text className="text-base text-foreground">
                {session.user.name ?? session.user.email}
              </Text>
              {session.user.email && (
                <Text className="font-mono text-sm text-muted-foreground">
                  {session.user.email}
                </Text>
              )}
            </Card>
          </CardStack>
        )}

        {session?.user && <HealthSyncSettings />}

        {session?.user && <CoachSection />}

        {session?.user && (
          <CardStack title="Integrations">
            <Card variant="secondary" className="overflow-hidden p-0">
              <ListRow
                icon={<Text className="text-lg">✈</Text>}
                title="Telegram"
                subtitle="Daily reminders"
                onPress={() => router.push("/settings/telegram")}
              />
            </Card>
          </CardStack>
        )}

        <CardStack title="Preferences">
          <Card variant="secondary" className="overflow-hidden p-0">
            <ListRow
              icon={
                <Ionicons
                  name={isDark ? "sunny-outline" : "moon-outline"}
                  size={20}
                  color={foreground}
                />
              }
              title="Dark mode"
              subtitle={isDark ? "On" : "Off"}
              onPress={toggleTheme}
              trailing={
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{isDark ? "On" : "Off"}</Chip.Label>
                </Chip>
              }
            />
            <ListRow
              icon={<Ionicons name="list-outline" size={20} color={foreground} />}
              title="Compact density"
              subtitle={density === "compact" ? "On" : "Off"}
              onPress={() =>
                setDensity((prev) => (prev === "comfortable" ? "compact" : "comfortable"))
              }
              trailing={
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{density}</Chip.Label>
                </Chip>
              }
            />
          </Card>
        </CardStack>

        <Pressable
          onPress={() => void handleSignOut()}
          className="min-h-14 items-center justify-center rounded-lg bg-destructive active:opacity-70"
          accessibilityRole="button"
          accessibilityLabel="Sign out"
        >
          <Text className="font-medium text-destructive-foreground">Sign out</Text>
        </Pressable>
      </View>
    </Container>
  );
}

function CoachSection() {
  const queryClient = useQueryClient();
  const config = useQuery(orpc.coach.getConfig.queryOptions({ input: undefined }));

  if (config.isPending) return null;
  if (config.isError || !config.data) {
    return (
      <CardStack title="Coach">
        <Card variant="secondary" className="p-4">
          <Text className="text-sm text-muted-foreground">
            Could not load coach settings.{" "}
            <Text
              className="font-medium text-foreground underline"
              onPress={() => void config.refetch()}
            >
              Retry
            </Text>
          </Text>
        </Card>
      </CardStack>
    );
  }

  return <CoachForm initial={config.data} onSaved={() => void queryClient.invalidateQueries()} />;
}

function CoachForm({
  initial,
  onSaved,
}: {
  initial: {
    tone: CoachTone;
    assertiveness: number;
    riskTolerance: CoachRiskTolerance;
    medicalDisclaimerMode: CoachDisclaimerMode;
    selectedTemplateKey: CoachTemplateId;
  };
  onSaved: () => void;
}) {
  const [tone, setTone] = useState<CoachTone>(initial.tone);
  const [assertiveness, setAssertiveness] = useState<number>(initial.assertiveness);
  const [risk, setRisk] = useState<CoachRiskTolerance>(initial.riskTolerance);
  const [disclaimer, setDisclaimer] = useState<CoachDisclaimerMode>(initial.medicalDisclaimerMode);
  const [template, setTemplate] = useState<CoachTemplateId>(initial.selectedTemplateKey);

  useEffect(() => {
    setTone(initial.tone);
    setAssertiveness(initial.assertiveness);
    setRisk(initial.riskTolerance);
    setDisclaimer(initial.medicalDisclaimerMode);
    setTemplate(initial.selectedTemplateKey);
  }, [initial]);

  const save = useMutation(
    orpc.coach.upsertConfig.mutationOptions({
      onSuccess: () => onSaved(),
    }),
  );

  const dirty =
    tone !== initial.tone ||
    assertiveness !== initial.assertiveness ||
    risk !== initial.riskTolerance ||
    disclaimer !== initial.medicalDisclaimerMode ||
    template !== initial.selectedTemplateKey;

  return (
    <CardStack title="Coach">
      <Card variant="secondary" className="gap-4 p-4">
        <CoachSelect
          label="Tone"
          hint={toneDescription(tone)}
          value={tone}
          onChange={setTone}
          values={COACH_TONE_VALUES}
          format={toneLabel}
        />
        <CoachSelect
          label={`Assertiveness (${assertivenessLabel(assertiveness)})`}
          hint={`1 = very gentle, 5 = very forceful. Currently ${assertiveness} of 5.`}
          value={String(assertiveness)}
          onChange={(next) => setAssertiveness(Number(next))}
          values={["1", "2", "3", "4", "5"]}
          format={(value) => `${value} · ${assertivenessLabel(Number(value))}`}
        />
        <CoachSelect
          label="Risk tolerance"
          hint={riskDescription(risk)}
          value={risk}
          onChange={setRisk}
          values={COACH_RISK_VALUES}
          format={riskLabel}
        />
        <CoachSelect
          label="Medical disclaimer"
          value={disclaimer}
          onChange={setDisclaimer}
          values={COACH_DISCLAIMER_VALUES}
          format={disclaimerLabel}
        />
        <CoachSelect
          label="Template"
          hint={templateDescription(template)}
          value={template}
          onChange={setTemplate}
          values={COACH_TEMPLATE_VALUES}
          format={templateLabel}
        />

        <View className="flex-row items-center gap-3">
          <Button
            onPress={() =>
              save.mutate({
                tone,
                assertiveness,
                riskTolerance: risk,
                medicalDisclaimerMode: disclaimer,
                selectedTemplateKey: template,
              })
            }
            isDisabled={!dirty || save.isPending}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {save.isSuccess && !dirty ? (
            <Text className="text-sm text-success">Saved</Text>
          ) : save.isError ? (
            <Text className="text-sm text-destructive">Could not save.</Text>
          ) : null}
        </View>
      </Card>
    </CardStack>
  );
}

function CoachSelect<V extends string>({
  label,
  hint,
  value,
  onChange,
  values,
  format,
}: {
  label: string;
  hint?: string;
  value: V;
  onChange: (next: V) => void;
  values: readonly V[];
  format: (value: V) => string;
}) {
  return (
    <View className="gap-2">
      <Text className="text-sm font-medium text-foreground">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {values.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              className={`rounded-full border px-3 py-1.5 active:opacity-70 ${
                selected ? "border-primary bg-primary/15" : "border-border bg-card"
              }`}
            >
              <Text
                className={`text-sm ${
                  selected ? "font-medium text-foreground" : "text-muted-foreground"
                }`}
              >
                {format(option)}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text className="text-xs text-muted-foreground">{hint}</Text> : null}
    </View>
  );
}
