import type { MessageDescriptor } from "@lingui/core";
import { Trans, useLingui } from "@lingui/react/macro";
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
import { Button } from "heroui-native";
import { router, useFocusEffect } from "expo-router";
import {
  Bell,
  Bot,
  Code2,
  Info,
  LayoutGrid,
  List,
  Moon,
  Plug,
  Scale,
  Send,
  Server,
  ShieldCheck,
  Smartphone,
  SlidersHorizontal,
  Sun,
  Trash2,
  UserRound,
  Watch,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Linking, Pressable, Text, TextInput, View } from "react-native";

import {
  ErrorState,
  Icon,
  Page,
  PageHeader,
  RowChevron,
  Section,
  Sheet,
  StatusPill,
} from "@/components/bloom";
import { CloudAccessNotice } from "@/components/cloud-access-notice";
import { ListRow } from "@/components/list-row";
import { Container } from "@/components/container";
import { HealthSyncSettings } from "@/components/health-sync-settings";
import {
  choiceChip,
  choiceText,
  LanguageSection,
  SettingsGroup,
  SettingsIcon,
} from "@/components/language-section";
import { AnalyticsConsentSection } from "@/components/analytics-consent-section";
import { AiSection } from "@/components/ai-section";
import { ServerSection } from "@/components/change-server";
import { SignInMethodsSection } from "@/components/sign-in-methods";
import { useAppTheme } from "@/contexts/app-theme-context";
import { authClient } from "@/lib/auth-client";
import { signOutOfThisPhone } from "@/lib/sign-out";
import { orpc } from "@/utils/orpc";
import { adminAccessQueryOptions } from "@/utils/admin-settings";

export default function SettingsScreen() {
  const { isDark, toggleTheme } = useAppTheme();
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const { data: session, isPending: sessionPending } = authClient.useSession();

  const { t } = useLingui();
  const displayName = session?.user ? (session.user.name ?? session.user.email) : null;

  return (
    <Container>
      <Page>
        <PageHeader title={t`Settings`} />

        <CloudAccessNotice />

        <Section title={t`Account`} icon={UserRound} tone="signal">
          <SettingsGroup>
            <View className="flex-row flex-wrap items-center gap-4 py-4">
              {session?.user ? (
                <>
                  <View
                    className="h-12 w-12 shrink-0 items-center justify-center rounded-full bg-sidebar-accent"
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                  >
                    <Text className="font-display text-xl font-medium text-signal">
                      {(displayName ?? "?").trim().charAt(0).toUpperCase()}
                    </Text>
                  </View>
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="font-display text-lg font-medium text-ink">{displayName}</Text>
                    {session.user.email && (
                      <Text className="font-sans text-sm text-ink-3" numberOfLines={1}>
                        {session.user.email}
                      </Text>
                    )}
                  </View>
                </>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onPress={() => void signOutOfThisPhone()}
                accessibilityLabel={t`Sign out`}
              >
                <Button.Label>
                  <Trans>Sign out</Trans>
                </Button.Label>
              </Button>
            </View>
          </SettingsGroup>
        </Section>

        {/* Issue #296 — connect and disconnect Google, Apple and OIDC. */}
        {session?.user && <SignInMethodsSection />}

        <ServerSection />

        <LanguageSection />

        {session?.user && (
          <Section title={t`Profile`} icon={UserRound} tone="signal">
            <Sheet className="overflow-hidden p-0 py-1">
              <ListRow
                icon={<Icon icon={UserRound} size={18} color="ink-2" />}
                title={t`Your profile`}
                subtitle={t`Optional answers only you can see`}
                onPress={() => router.push("/profile")}
                showDivider
                trailing={<RowChevron />}
              />
              <ListRow
                icon={<Icon icon={Bell} size={18} color="ink-2" />}
                title={t`Insight notifications`}
                subtitle={t`Push and weekly email, off until you turn them on`}
                onPress={() => router.push("/insight-settings")}
                showDivider
                trailing={<RowChevron />}
              />
              <ListRow
                icon={<Icon icon={LayoutGrid} size={18} color="ink-2" />}
                title={t`Modules`}
                subtitle={t`Choose the parts of the app you want to see`}
                onPress={() => router.push("/settings/modules")}
                trailing={<RowChevron />}
              />
            </Sheet>
          </Section>
        )}

        {session?.user && <HealthSyncSettings />}

        {session?.user && (
          <Section title={t`Integrations`} icon={Plug} tone="signal">
            <Sheet className="overflow-hidden p-0 py-1">
              <ListRow
                icon={<Icon icon={Watch} size={18} color="ink-2" />}
                title={t`Devices`}
                subtitle={t`Cloud wearable connections`}
                onPress={() => router.push("/settings/devices")}
                showDivider
                trailing={<RowChevron />}
              />
              <ListRow
                icon={<Icon icon={Send} size={18} color="ink-2" />}
                title="Telegram"
                subtitle={t`Daily reminders`}
                onPress={() => router.push("/settings/telegram")}
                trailing={<RowChevron />}
              />
            </Sheet>
          </Section>
        )}

        {session?.user && <AnalyticsConsentSection />}

        {session?.user && <CoachSection />}
        {session?.user && <AiSection />}

        {session?.user && (
          <AdministrationRow userId={session.user.id} sessionPending={sessionPending} />
        )}

        <Section title={t`Preferences`} icon={SlidersHorizontal} tone="signal">
          <Sheet className="overflow-hidden p-0 py-1">
            <ListRow
              icon={<Icon icon={isDark ? Sun : Moon} size={18} color="ink-2" />}
              title={t`Dark mode`}
              subtitle={isDark ? t`On` : t`Off`}
              onPress={toggleTheme}
              showDivider
              trailing={
                <StatusPill tone={isDark ? "good" : "neutral"}>
                  {isDark ? t`On` : t`Off`}
                </StatusPill>
              }
            />
            <ListRow
              icon={<Icon icon={List} size={18} color="ink-2" />}
              title={t`Compact density`}
              subtitle={density === "compact" ? t`On` : t`Off`}
              onPress={() =>
                setDensity((prev) => (prev === "comfortable" ? "compact" : "comfortable"))
              }
              trailing={
                <StatusPill tone="neutral">
                  {density === "compact" ? t`compact` : t`comfortable`}
                </StatusPill>
              }
            />
          </Sheet>
        </Section>

        {session?.user && <DeleteAccountSection onSignOut={signOutOfThisPhone} />}

        <AboutSection />
      </Page>
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

  if (preview.isPending) return null;
  if (preview.isError || !preview.data) {
    return (
      <Section title={t`Delete account`} icon={Trash2}>
        <ErrorState
          title={t`Could not load what would be deleted.`}
          action={
            <Button variant="outline" size="sm" onPress={() => void preview.refetch()}>
              <Button.Label>{t`Retry`}</Button.Label>
            </Button>
          }
        />
      </Section>
    );
  }
  const data = preview.data;
  const rows = data.totalRows.toLocaleString();
  const organizationCount = data.organizations.length;
  const blockerNames = data.blockers.map((b) => b.organizationName).join(", ");
  const confirmationPhrase = data.confirmationPhrase;
  const typeToConfirm = t({ message: `Type ${confirmationPhrase} to confirm`, comment: "safety" });

  return (
    <Section title={t`Delete account`} icon={Trash2}>
      <Sheet className="gap-3">
        <Text className="font-sans text-sm leading-relaxed text-ink-2">
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
          <Text className="font-sans text-sm text-destructive">
            <Trans comment="safety">
              {blockerNames} also has another owner. Remove them or transfer the record before
              deleting.
            </Trans>
          </Text>
        ) : data.reauthRequired ? (
          <>
            <Text className="font-sans text-sm text-ink-3">
              <Trans>
                For your security, sign out and sign back in, then return here within 10 minutes.
              </Trans>
            </Text>
            <Button variant="outline" className="self-start" onPress={() => void onSignOut()}>
              <Button.Label>
                <Trans>Sign out to confirm it's you</Trans>
              </Button.Label>
            </Button>
          </>
        ) : (
          <>
            <Text className="font-sans text-sm text-ink-2">{typeToConfirm}</Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              accessibilityLabel={typeToConfirm}
              className="rounded-xl border border-rule bg-paper px-3 py-2.5 font-sans text-base text-ink"
            />
            <Button
              variant="danger"
              onPress={() => remove.mutate({ confirmation: typed })}
              isDisabled={typed !== data.confirmationPhrase || remove.isPending}
              accessibilityRole="button"
              accessibilityLabel={t({ message: "Delete everything", comment: "safety" })}
            >
              <Button.Label>
                {remove.isPending
                  ? t`Deleting…`
                  : t({ message: "Delete everything", comment: "safety" })}
              </Button.Label>
            </Button>
          </>
        )}
        {error && <Text className="font-sans text-sm text-destructive">{error}</Text>}
      </Sheet>
    </Section>
  );
}

/**
 * Licence notice and source links (Issue #56): the server's source, which
 * AGPL-3.0 section 13 requires it to offer, and this app's own source, which
 * LICENSE-APP-STORE requires an app-store build to point to.
 */
function AboutSection() {
  const about = useQuery(orpc.about.info.queryOptions({ input: {} }));
  const { t } = useLingui();
  const serverSource = about.data?.sourceCodeUrl;

  return (
    <Section title={t`About`} icon={Info} tone="signal">
      <Sheet className="overflow-hidden p-0 py-1">
        <View className="flex-row items-center gap-3 border-b border-rule px-4 py-3">
          <SettingsIcon icon={Scale} />
          <Text className="flex-1 font-sans text-sm leading-relaxed text-ink-2">
            <Trans>
              OpenValens is free software under the GNU Affero General Public License, version 3 or
              later.
            </Trans>
          </Text>
        </View>
        <ListRow
          icon={<Icon icon={Smartphone} size={18} color="ink-2" />}
          title={t`Source code for this app`}
          subtitle={UPSTREAM_SOURCE_CODE_URL}
          onPress={() => void Linking.openURL(UPSTREAM_SOURCE_CODE_URL)}
          showDivider={!!serverSource}
          trailing={<Icon icon={Code2} size={16} />}
        />
        {serverSource ? (
          <ListRow
            icon={<Icon icon={Server} size={18} color="ink-2" />}
            title={t`Source code for this server`}
            subtitle={serverSource}
            onPress={() => void Linking.openURL(serverSource)}
            trailing={<Icon icon={Code2} size={16} />}
          />
        ) : null}
      </Sheet>
    </Section>
  );
}

function CoachSection() {
  const queryClient = useQueryClient();
  const config = useQuery(orpc.coach.getConfig.queryOptions({ input: undefined }));
  const { t } = useLingui();

  if (config.isPending) {
    return (
      <Section title={t`Coach`} icon={Bot} tone="signal">
        <Sheet>
          <Text className="font-sans text-sm text-ink-3">{t`Loading…`}</Text>
        </Sheet>
      </Section>
    );
  }
  if (config.isError || !config.data) {
    return (
      <Section title={t`Coach`} icon={Bot} tone="signal">
        <ErrorState
          title={t`Could not load coach settings.`}
          action={
            <Button variant="outline" size="sm" onPress={() => void config.refetch()}>
              <Button.Label>{t`Retry`}</Button.Label>
            </Button>
          }
        />
      </Section>
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
    <Section title={t`Coach`} icon={Bot} tone="signal">
      <Sheet className="gap-5">
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
          format={(value) => `${value}: ${assertivenessText(Number(value))}`}
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
            <Button.Label>{save.isPending ? t`Saving…` : t`Save`}</Button.Label>
          </Button>
          {save.isSuccess && !dirty ? (
            <StatusPill tone="good">
              <Trans>Saved</Trans>
            </StatusPill>
          ) : save.isError ? (
            <Text className="font-sans text-sm text-destructive">
              <Trans>Could not save.</Trans>
            </Text>
          ) : null}
        </View>
      </Sheet>
    </Section>
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
    <Section title={t`Administration`} icon={ShieldCheck} tone="signal">
      <Sheet className="overflow-hidden p-0 py-1">
        <ListRow
          icon={<Icon icon={ShieldCheck} size={18} color="ink-2" />}
          title={t`Instance configuration`}
          subtitle={t`View global environment settings`}
          onPress={() => router.push("/admin/settings")}
          trailing={<RowChevron />}
        />
      </Sheet>
    </Section>
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
      <Text className="font-sans text-sm font-medium text-ink-2">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {values.map((option) => {
          const selected = option === value;
          return (
            <Pressable
              key={option}
              onPress={() => onChange(option)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              className={choiceChip(selected)}
            >
              <Text className={choiceText(selected)}>{format(option)}</Text>
            </Pressable>
          );
        })}
      </View>
      {hint ? <Text className="font-sans text-sm text-ink-3">{hint}</Text> : null}
    </View>
  );
}
