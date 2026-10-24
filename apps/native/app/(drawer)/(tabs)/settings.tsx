import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
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
} from "@openvalens/api/presenters/coach-settings";
import { UPSTREAM_SOURCE_CODE_URL } from "@openvalens/api/source-code";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Card, Chip, useThemeColor } from "heroui-native";
import { router, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";

import { CardStack, ListRow } from "@/components/list-row";
import { Container } from "@/components/container";
import { HealthSyncSettings } from "@/components/health-sync-settings";
import { LanguageSection } from "@/components/language-section";
import { AnalyticsConsentSection } from "@/components/analytics-consent-section";
import { AiSection } from "@/components/ai-section";
import { useAppTheme } from "@/contexts/app-theme-context";
import { authClient } from "@/lib/auth-client";
import { prepareOfflineSignOut } from "@/lib/offline/sync";
import { disablePushOnThisPhone } from "@/lib/push-notifications";
import { resetHealthSync } from "@/lib/health-sync";
import { orpc, queryClient } from "@/utils/orpc";
import { adminAccessQueryOptions } from "@/utils/admin-settings";

export default function SettingsScreen() {
  const { isDark, toggleTheme } = useAppTheme();
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const foreground = useThemeColor("foreground");
  const { t } = useLingui();

  const handleSignOut = async () => {
    // Issue #92 — stop insight pushes to this phone for the signed-out account.
    await disablePushOnThisPhone().catch(() => undefined);
    await resetHealthSync();
    await prepareOfflineSignOut();
    await authClient.signOut();
    queryClient.clear();
  };

  return (
    <Container className="p-4">
      <View className="gap-6">
        {session?.user && (
          <CardStack title={t`Account`}>
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

        <LanguageSection />

        {session?.user && (
          <CardStack title={t`Profile`}>
            <Card variant="secondary" className="overflow-hidden p-0">
              <ListRow
                icon={<Ionicons name="person-outline" size={20} color={foreground} />}
                title={t`Your profile`}
                subtitle={t`Optional answers only you can see`}
                onPress={() => router.push("/profile")}
              />
              <ListRow
                icon={<Ionicons name="notifications-outline" size={20} color={foreground} />}
                title={t`Insight notifications`}
                subtitle={t`Push and weekly email, off until you turn them on`}
                onPress={() => router.push("/insight-settings")}
              />
            </Card>
          </CardStack>
        )}

        {session?.user && <HealthSyncSettings />}
        {session?.user && <AnalyticsConsentSection />}

        {session?.user && <CoachSection />}
        {session?.user && <AiSection />}

        {session?.user && (
          <CardStack title={t`Integrations`}>
            <Card variant="secondary" className="overflow-hidden p-0">
              <ListRow
                icon={<Ionicons name="watch-outline" size={20} color={foreground} />}
                title={t`Devices`}
                subtitle={t`Cloud wearable connections`}
                onPress={() => router.push("/settings/devices")}
              />
              <ListRow
                icon={<Text className="text-lg">✈</Text>}
                title="Telegram"
                subtitle={t`Daily reminders`}
                onPress={() => router.push("/settings/telegram")}
              />
            </Card>
          </CardStack>
        )}

        {session?.user && (
          <AdministrationRow userId={session.user.id} sessionPending={sessionPending} />
        )}

        <CardStack title={t`Preferences`}>
          <Card variant="secondary" className="overflow-hidden p-0">
            <ListRow
              icon={
                <Ionicons
                  name={isDark ? "sunny-outline" : "moon-outline"}
                  size={20}
                  color={foreground}
                />
              }
              title={t`Dark mode`}
              subtitle={isDark ? t`On` : t`Off`}
              onPress={toggleTheme}
              trailing={
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{isDark ? t`On` : t`Off`}</Chip.Label>
                </Chip>
              }
            />
            <ListRow
              icon={<Ionicons name="list-outline" size={20} color={foreground} />}
              title={t`Compact density`}
              subtitle={density === "compact" ? t`On` : t`Off`}
              onPress={() =>
                setDensity((prev) => (prev === "comfortable" ? "compact" : "comfortable"))
              }
              trailing={
                <Chip size="sm" variant="secondary">
                  <Chip.Label>{density === "compact" ? t`compact` : t`comfortable`}</Chip.Label>
                </Chip>
              }
            />
          </Card>
        </CardStack>

        <Pressable
          onPress={() => void handleSignOut()}
          className="min-h-14 items-center justify-center rounded-lg bg-destructive active:opacity-70"
          accessibilityRole="button"
          accessibilityLabel={t`Sign out`}
        >
          <Text className="font-medium text-destructive-foreground">
            <Trans>Sign out</Trans>
          </Text>
        </Pressable>

        {session?.user && <DeleteAccountSection onSignOut={handleSignOut} />}

        <AboutSection />
      </View>
    </Container>
  );
}

/**
 * "Delete everything" (Issue #89): preview, co-owner blockers, fresh sign-in
 * (sign out and back in), typed confirmation, then local wipe and sign-out.
 */
function DeleteAccountSection({ onSignOut }: { onSignOut: () => Promise<void> }) {
  const preview = useQuery(orpc.dataRights.deletionPreview.queryOptions({ input: {} }));
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { t } = useLingui();
  const remove = useMutation(
    orpc.dataRights.deleteEverything.mutationOptions({
      onSuccess: () => void onSignOut(),
      onError: (err) => {
        setError(err.message);
        void preview.refetch();
      },
    }),
  );

  if (preview.isPending || preview.isError || !preview.data) return null;
  const data = preview.data;
  const rows = data.totalRows.toLocaleString();
  const organizationCount = data.organizations.length;
  const blockerNames = data.blockers.map((b) => b.organizationName).join(", ");
  const confirmationPhrase = data.confirmationPhrase;
  const typeToConfirm = t({ message: `Type ${confirmationPhrase} to confirm`, comment: "safety" });

  return (
    <CardStack title={t`Delete account`}>
      <Card variant="secondary" className="gap-3 p-4">
        <Text className="text-sm text-foreground">
          {organizationCount === 1 ? (
            <Trans comment="safety">
              Permanently deletes your account and {rows} stored rows across your health record.
              This can't be undone. Export your data from Clinical export first.
            </Trans>
          ) : (
            <Trans comment="safety">
              Permanently deletes your account and {rows} stored rows across {organizationCount}{" "}
              health records. This can't be undone. Export your data from Clinical export first.
            </Trans>
          )}
        </Text>
        {data.blockers.length > 0 ? (
          <Text className="text-sm text-destructive">
            <Trans comment="safety">
              {blockerNames} also has another owner. Remove them or transfer the record before
              deleting.
            </Trans>
          </Text>
        ) : data.reauthRequired ? (
          <>
            <Text className="text-sm text-muted-foreground">
              <Trans>
                For your security, sign out and sign back in, then return here within 10 minutes.
              </Trans>
            </Text>
            <Button variant="secondary" onPress={() => void onSignOut()}>
              <Button.Label>
                <Trans>Sign out to confirm it's you</Trans>
              </Button.Label>
            </Button>
          </>
        ) : (
          <>
            <Text className="text-sm text-foreground">{typeToConfirm}</Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel={typeToConfirm}
              className="rounded-lg border border-border px-3 py-2 font-mono text-foreground"
            />
            <Pressable
              onPress={() => remove.mutate({ confirmation: typed })}
              disabled={typed !== data.confirmationPhrase || remove.isPending}
              className="min-h-12 items-center justify-center rounded-lg bg-destructive active:opacity-70 disabled:opacity-40"
              accessibilityRole="button"
              accessibilityLabel={t({ message: "Delete everything", comment: "safety" })}
            >
              <Text className="font-medium text-destructive-foreground">
                {remove.isPending
                  ? t`Deleting…`
                  : t({ message: "Delete everything", comment: "safety" })}
              </Text>
            </Pressable>
          </>
        )}
        {error && <Text className="text-sm text-destructive">{error}</Text>}
      </Card>
    </CardStack>
  );
}

/**
 * Licence notice and source links (Issue #56): the server's source, which
 * AGPL-3.0 section 13 requires it to offer, and this app's own source, which
 * LICENSE-APP-STORE requires an app-store build to point to.
 */
function AboutSection() {
  const about = useQuery(orpc.about.info.queryOptions({ input: {} }));
  const foreground = useThemeColor("foreground");
  const { t } = useLingui();
  const serverSource = about.data?.sourceCodeUrl;

  return (
    <CardStack title={t`About`}>
      <Card variant="secondary" className="overflow-hidden p-0">
        <Text className="px-4 pt-4 pb-2 text-sm text-muted-foreground">
          <Trans>
            OpenValens is free software under the GNU Affero General Public License, version 3 or
            later.
          </Trans>
        </Text>
        <ListRow
          icon={<Ionicons name="phone-portrait-outline" size={20} color={foreground} />}
          title={t`Source code for this app`}
          subtitle={UPSTREAM_SOURCE_CODE_URL}
          onPress={() => void Linking.openURL(UPSTREAM_SOURCE_CODE_URL)}
        />
        {serverSource ? (
          <ListRow
            icon={<Ionicons name="server-outline" size={20} color={foreground} />}
            title={t`Source code for this server`}
            subtitle={serverSource}
            onPress={() => void Linking.openURL(serverSource)}
          />
        ) : null}
      </Card>
    </CardStack>
  );
}

function CoachSection() {
  const queryClient = useQueryClient();
  const config = useQuery(orpc.coach.getConfig.queryOptions({ input: undefined }));
  const { t } = useLingui();

  if (config.isPending) return null;
  if (config.isError || !config.data) {
    return (
      <CardStack title={t`Coach`}>
        <Card variant="secondary" className="p-4">
          <Text className="text-sm text-muted-foreground">
            <Trans>Could not load coach settings.</Trans>{" "}
            <Text
              className="font-medium text-foreground underline"
              onPress={() => void config.refetch()}
            >
              <Trans>Retry</Trans>
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
  const { t, i18n } = useLingui();
  const text = (message: MessageDescriptor | null) => (message ? i18n._(message) : undefined);
  const assertivenessText = (value: number) => i18n._(assertivenessLabel(value));

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
    <CardStack title={t`Coach`}>
      <Card variant="secondary" className="gap-4 p-4">
        <CoachSelect
          label={t`Tone`}
          hint={text(toneDescription(tone))}
          value={tone}
          onChange={setTone}
          values={COACH_TONE_VALUES}
          format={(value) => i18n._(toneLabel(value))}
        />
        <CoachSelect
          label={t`Assertiveness (${assertivenessText(assertiveness)})`}
          hint={t`1 = very gentle, 5 = very forceful. Currently ${assertiveness} of 5.`}
          value={String(assertiveness)}
          onChange={(next) => setAssertiveness(Number(next))}
          values={["1", "2", "3", "4", "5"]}
          format={(value) => `${value} · ${assertivenessText(Number(value))}`}
        />
        <CoachSelect
          label={t`Risk tolerance`}
          hint={text(riskDescription(risk))}
          value={risk}
          onChange={setRisk}
          values={COACH_RISK_VALUES}
          format={(value) => i18n._(riskLabel(value))}
        />
        <CoachSelect
          label={t({ message: "Medical disclaimer", comment: "safety" })}
          value={disclaimer}
          onChange={setDisclaimer}
          values={COACH_DISCLAIMER_VALUES}
          format={(value) => i18n._(disclaimerLabel(value))}
        />
        <CoachSelect
          label={t`Template`}
          hint={text(templateDescription(template))}
          value={template}
          onChange={setTemplate}
          values={COACH_TEMPLATE_VALUES}
          format={(value) => i18n._(templateLabel(value))}
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
            {save.isPending ? t`Saving…` : t`Save`}
          </Button>
          {save.isSuccess && !dirty ? (
            <Text className="text-sm text-success">
              <Trans>Saved</Trans>
            </Text>
          ) : save.isError ? (
            <Text className="text-sm text-destructive">
              <Trans>Could not save.</Trans>
            </Text>
          ) : null}
        </View>
      </Card>
    </CardStack>
  );
}

function AdministrationRow({
  userId,
  sessionPending,
}: {
  userId: string;
  sessionPending: boolean;
}) {
  const access = useQuery({
    ...adminAccessQueryOptions(userId),
    enabled: !!userId,
  });

  // The settings tab can stay mounted; refresh admin access on focus so a
  // revoked role removes the link promptly.
  useFocusEffect(
    useCallback(() => {
      if (userId) {
        void access.refetch();
      }
    }, [access.refetch, userId]),
  );

  const foreground = useThemeColor("foreground");
  const { t } = useLingui();

  const showAdministration =
    !!userId &&
    !sessionPending &&
    !access.isPending &&
    !access.isFetching &&
    !access.isError &&
    access.data?.isInstanceAdmin === true;

  if (!showAdministration) {
    return null;
  }

  return (
    <CardStack title={t`Administration`}>
      <Card variant="secondary" className="overflow-hidden p-0">
        <ListRow
          icon={<Ionicons name="shield-outline" size={20} color={foreground} />}
          title={t`Instance configuration`}
          subtitle={t`View global environment settings`}
          onPress={() => router.push("/admin/settings")}
        />
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
