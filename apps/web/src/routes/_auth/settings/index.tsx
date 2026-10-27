import type { MessageDescriptor } from "@lingui/core";
import { Plural, Trans, useLingui } from "@lingui/react/macro";
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
  type CoachProfileLike,
  type CoachRiskTolerance,
  type CoachTemplateId,
  type CoachTone,
} from "@openvalens/api/presenters/coach-settings";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Label } from "@openvalens/ui/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@openvalens/ui/components/select";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { INSIGHT_DELIVERY_COPY } from "@openvalens/api/presenters/insights";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Bot, ChevronRight, LayoutGrid, Plug, Send, Trash2, UserRound, Watch } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AboutSection } from "@/components/about-section";
import { AiConsentSection } from "@/components/ai-consent-section";
import { AiWorkspaceConsentSection } from "@/components/ai-workspace-consent-section";
import { AnalyticsConsentSection } from "@/components/analytics-consent-section";
import { InsightNotificationsSection } from "@/components/insight-notifications-section";
import { LanguageSection } from "@/components/language-section";
import { OidcConnectSection } from "@/components/oidc-connect-section";
import { ErrorState, InfoTip, Page, PageHeader, Section } from "@/components/page";
import { ProfileSummarySection } from "@/components/profile-summary-card";
import { SettingsGroup, SettingsIcon } from "@/components/settings-rows";
import { authClient } from "@/lib/auth-client";
import { prepareOfflineSignOut } from "@/utils/sync-engine";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/settings/")({
  component: SettingsPage,
});

const LINK =
  "underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:decoration-2";

function SettingsPage() {
  const { t, i18n } = useLingui();
  // The in-page index: each entry anchors a section below. Sign-in methods
  // sits under Account, the two AI switches under one entry.
  const index = [
    { id: "account", label: t`Account` },
    { id: "language", label: t`Language` },
    { id: "profile", label: t`Profile` },
    { id: "modules", label: t`Modules` },
    { id: "notifications", label: i18n._(INSIGHT_DELIVERY_COPY.settingsTitle) },
    { id: "integrations", label: t`Integrations` },
    { id: "analytics", label: t`Usage analytics` },
    { id: "coach", label: t`Coach` },
    { id: "ai", label: t`AI processing` },
    { id: "delete-account", label: t`Delete account and all data` },
    { id: "about", label: t`About` },
  ];

  return (
    <Page>
      <PageHeader title={<Trans>Settings</Trans>} />
      <div className="grid gap-10 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-14">
        <nav aria-label={t`Settings`} className="hidden lg:block">
          <ul className="sticky top-10 grid gap-0.5">
            {index.map((item) => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className="block rounded-full px-3 py-1.5 text-sm text-ink-2 transition-colors duration-[var(--dur-short)] hover:bg-paper-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid min-w-0 max-w-3xl content-start gap-10">
          <div id="account" className="grid scroll-mt-10 gap-10">
            <AccountSection />
            <OidcConnectSection />
          </div>
          <div id="language" className="scroll-mt-10">
            <LanguageSection />
          </div>
          <div id="profile" className="scroll-mt-10">
            <ProfileSummarySection />
          </div>
          <div id="modules" className="scroll-mt-10">
            <ModulesSection />
          </div>
          <div id="notifications" className="scroll-mt-10">
            <InsightNotificationsSection />
          </div>
          <div id="integrations" className="scroll-mt-10">
            <IntegrationsSection />
          </div>
          <div id="analytics" className="scroll-mt-10">
            <AnalyticsConsentSection />
          </div>
          <div id="coach" className="scroll-mt-10">
            <CoachSection />
          </div>
          <div id="ai" className="grid scroll-mt-10 gap-10">
            <AiWorkspaceConsentSection />
            <AiConsentSection />
          </div>
          <div id="delete-account" className="scroll-mt-10">
            <DeleteAccountSection />
          </div>
          <div id="about" className="scroll-mt-10">
            <AboutSection />
          </div>
        </div>
      </div>
    </Page>
  );
}

/** Onboarding stage 1: the link to Settings › Modules. */
function ModulesSection() {
  return (
    <Section title={<Trans>Modules</Trans>} icon={LayoutGrid} tone="signal">
      <SettingsGroup className="px-0">
        <IntegrationLink
          to="/settings/modules"
          icon={LayoutGrid}
          label={<Trans>Modules</Trans>}
          description={<Trans>Choose the parts of the app you use.</Trans>}
        />
      </SettingsGroup>
    </Section>
  );
}

/** Links to the per-integration pages under /settings. */
function IntegrationsSection() {
  return (
    <Section title={<Trans>Integrations</Trans>} icon={Plug} tone="signal">
      <SettingsGroup className="px-0">
        <IntegrationLink
          to="/settings/devices"
          icon={Watch}
          label={<Trans>Devices</Trans>}
          description={<Trans>Connect a wearable vendor account such as Oura or WHOOP</Trans>}
        />
        <IntegrationLink
          to="/settings/telegram"
          icon={Send}
          label="Telegram"
          description={<Trans>Daily reminders</Trans>}
        />
      </SettingsGroup>
    </Section>
  );
}

function IntegrationLink({
  to,
  icon,
  label,
  description,
}: {
  to: "/settings/devices" | "/settings/telegram" | "/settings/modules";
  icon: typeof Watch;
  label: React.ReactNode;
  description: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-16 items-center gap-4 px-5 py-3 no-underline transition-colors duration-[var(--dur-short)] first:rounded-t-3xl last:rounded-b-3xl hover:bg-paper-2 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
    >
      <SettingsIcon icon={icon} />
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-medium text-ink">{label}</span>
        <span className="text-sm text-ink-3">{description}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden="true" />
    </Link>
  );
}

function AccountSection() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <Skeleton className="h-24 w-full rounded-3xl" />;
  if (!session) return null;
  const displayName = session.user.name ?? session.user.email;

  return (
    <Section title={<Trans>Account</Trans>} icon={UserRound} tone="signal">
      <SettingsGroup>
        <div className="flex flex-wrap items-center gap-4 py-4">
          <span
            className="grid size-12 shrink-0 place-items-center rounded-full bg-sidebar-accent font-display text-xl font-medium text-signal"
            aria-hidden="true"
          >
            {(displayName ?? "?").trim().charAt(0).toUpperCase()}
          </span>
          <div className="grid min-w-0 flex-1 basis-40 gap-0.5">
            <span className="font-display text-lg font-medium text-ink">{displayName}</span>
            {session.user.email && (
              <span className="text-sm break-all text-ink-3">{session.user.email}</span>
            )}
          </div>
          <Button
            variant="outline"
            onClick={async () => {
              await prepareOfflineSignOut();
              await authClient.signOut({
                fetchOptions: {
                  onSuccess: () => navigate({ to: "/" }),
                },
              });
            }}
          >
            <Trans>Sign out</Trans>
          </Button>
        </div>
      </SettingsGroup>
    </Section>
  );
}

function CoachSection() {
  const queryClient = useQueryClient();
  const config = useQuery(orpc.coach.getConfig.queryOptions({ input: undefined }));

  if (config.isPending) return <Skeleton className="h-64 w-full rounded-3xl" />;
  if (config.isError || !config.data) {
    return (
      <Section title={<Trans>Coach</Trans>} icon={Bot} tone="signal">
        <ErrorState
          title={<Trans>Could not load coach settings.</Trans>}
          action={
            <Button variant="outline" onClick={() => void config.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Section>
    );
  }

  return <CoachForm initial={config.data} onSaved={() => void queryClient.invalidateQueries()} />;
}

function CoachForm({ initial, onSaved }: { initial: CoachProfileLike; onSaved: () => void }) {
  const [tone, setTone] = useState<CoachTone>(initial.tone);
  const [assertiveness, setAssertiveness] = useState<number>(initial.assertiveness);
  const [risk, setRisk] = useState<CoachRiskTolerance>(initial.riskTolerance);
  const [disclaimer, setDisclaimer] = useState<CoachDisclaimerMode>(initial.medicalDisclaimerMode);
  const [template, setTemplate] = useState<CoachTemplateId>(initial.selectedTemplateKey);
  const { t, i18n } = useLingui();
  const hint = (message: MessageDescriptor | null) => (message ? i18n._(message) : undefined);
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

  const handleSave = () => {
    save.mutate({
      tone,
      assertiveness,
      riskTolerance: risk,
      medicalDisclaimerMode: disclaimer,
      selectedTemplateKey: template,
    });
  };

  return (
    <Section title={<Trans>Coach</Trans>} icon={Bot} tone="signal" sheet>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t`Tone`} hint={hint(toneDescription(tone))}>
          <Select value={tone} onValueChange={(Value) => setTone(Value as CoachTone)}>
            <SelectTrigger>
              <SelectValue>{i18n._(toneLabel(tone))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COACH_TONE_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {i18n._(toneLabel(value))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label={t`Assertiveness (${assertivenessText(assertiveness)})`}
          hint={t`1 = very gentle, 5 = very forceful. Currently ${assertiveness} of 5.`}
        >
          <Select
            value={String(assertiveness)}
            onValueChange={(Value) => setAssertiveness(Number(Value) as 1 | 2 | 3 | 4 | 5)}
          >
            <SelectTrigger>
              <SelectValue>
                <span className="num">{assertiveness}</span> {assertivenessText(assertiveness)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  <span className="num">{value}</span> {assertivenessText(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t`Risk tolerance`} hint={hint(riskDescription(risk))}>
          <Select value={risk} onValueChange={(Value) => setRisk(Value as CoachRiskTolerance)}>
            <SelectTrigger>
              <SelectValue>{i18n._(riskLabel(risk))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COACH_RISK_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {i18n._(riskLabel(value))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t({ message: "Medical disclaimer", comment: "safety" })}>
          <Select
            value={disclaimer}
            onValueChange={(Value) => setDisclaimer(Value as CoachDisclaimerMode)}
          >
            <SelectTrigger>
              <SelectValue>{i18n._(disclaimerLabel(disclaimer))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COACH_DISCLAIMER_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {i18n._(disclaimerLabel(value))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label={t`Template`} hint={hint(templateDescription(template))}>
          <Select value={template} onValueChange={(Value) => setTemplate(Value as CoachTemplateId)}>
            <SelectTrigger>
              <SelectValue>{i18n._(templateLabel(template))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COACH_TEMPLATE_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {i18n._(templateLabel(value))}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <div className="mt-5 flex items-center gap-3">
        <Button onClick={handleSave} disabled={!dirty || save.isPending}>
          {save.isPending ? t`Saving…` : t`Save`}
        </Button>
        {save.isSuccess && !dirty ? (
          <span className="text-sm text-success">
            <Trans>Saved</Trans>
          </span>
        ) : save.isError ? (
          <span className="text-sm text-destructive">
            <Trans>Could not save.</Trans>
          </span>
        ) : null}
      </div>
    </Section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <div className="flex min-h-7 items-center gap-1">
        <Label className="text-sm font-medium text-ink-3">{label}</Label>
        {hint ? <InfoTip>{hint}</InfoTip> : null}
      </div>
      {children}
    </div>
  );
}

/**
 * "Delete everything" (Issue #89): preview, export-first link, co-owner
 * blockers, fresh sign-in via magic link, typed confirmation, then sign-out.
 */
export function DeleteAccountSection() {
  const navigate = useNavigate();
  const { data: session } = authClient.useSession();
  const preview = useQuery(orpc.dataRights.deletionPreview.queryOptions({ input: {} }));
  const [typed, setTyped] = useState("");
  const [linkSent, setLinkSent] = useState(false);
  const { t } = useLingui();

  const remove = useMutation(
    orpc.dataRights.deleteEverything.mutationOptions({
      onSuccess: async () => {
        await prepareOfflineSignOut();
        await authClient.signOut({ fetchOptions: { onSuccess: () => navigate({ to: "/" }) } });
      },
      onError: (error) => {
        if ((error as { code?: string }).code === "REAUTH_REQUIRED") void preview.refetch();
        toast.error(error.message);
      },
    }),
  );

  if (preview.isPending) return <Skeleton className="h-40 w-full rounded-3xl" />;
  if (preview.isError || !preview.data) {
    return (
      <Section title={<Trans>Delete account and all data</Trans>} icon={Trash2}>
        <ErrorState
          title={<Trans>Could not load what would be deleted.</Trans>}
          action={
            <Button variant="outline" onClick={() => void preview.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Section>
    );
  }
  const data = preview.data;
  const rows = data.totalRows.toLocaleString();
  const organizationCount = data.organizations.length;
  const organizationNames = data.organizations.map((o) => o.name).join(", ");
  const blockerNames = data.blockers.map((b) => b.organizationName).join(", ");
  const confirmationPhrase = data.confirmationPhrase;

  const sendSignInLink = async () => {
    const email = session?.user.email;
    if (!email) return;
    const { error } = await authClient.signIn.magicLink({
      email,
      callbackURL: `${window.location.origin}/settings`,
    });
    if (error) toast.error(error.message ?? t`Could not send the sign-in link.`);
    else setLinkSent(true);
  };

  return (
    <Section title={<Trans>Delete account and all data</Trans>} icon={Trash2}>
      <div className="sheet grid gap-4 p-5">
        <p className="max-w-[65ch] text-ink-2">
          {organizationCount === 1 ? (
            <Trans comment="safety">
              This permanently deletes your account and {rows} stored rows across your health record
              ({organizationNames}). It can't be undone.
            </Trans>
          ) : organizationCount > 0 ? (
            <Trans comment="safety">
              This permanently deletes your account and {rows} stored rows across{" "}
              {organizationCount} health records ({organizationNames}). It can't be undone.
            </Trans>
          ) : (
            <Trans comment="safety">
              This permanently deletes your account and {rows} stored rows across{" "}
              {organizationCount} health records. It can't be undone.
            </Trans>
          )}{" "}
          <Trans>
            <Link to="/exports" className={LINK}>
              Download an export first
            </Link>
            .
          </Trans>
        </p>

        {data.blockers.length > 0 ? (
          <p className="text-sm text-destructive">
            <Plural
              comment="safety"
              value={data.blockers.length}
              one={`${blockerNames} also has another owner. Remove them or transfer the record before deleting.`}
              other={`${blockerNames} also have another owner. Remove them or transfer the record before deleting.`}
            />
          </p>
        ) : data.reauthRequired ? (
          <div className="grid gap-2">
            <p>
              <Trans>For your security, confirm it's you with a fresh sign-in.</Trans>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" onClick={sendSignInLink} disabled={linkSent}>
                {linkSent ? t`Sign-in link sent` : t`Email me a sign-in link`}
              </Button>
              {linkSent ? (
                <span role="status" className="text-sm text-ink-3">
                  <Trans>Check your email</Trans>
                </span>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <label htmlFor="delete-confirmation" className="text-sm text-ink-3">
              <Trans comment="safety">
                Type <span className="font-semibold text-ink">{confirmationPhrase}</span> to confirm
              </Trans>
            </label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="delete-confirmation"
                autoComplete="off"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                className="max-w-48"
              />
              <Button
                variant="destructive"
                disabled={typed !== data.confirmationPhrase || remove.isPending}
                onClick={() => remove.mutate({ confirmation: typed })}
              >
                {remove.isPending
                  ? t`Deleting…`
                  : t({ message: "Delete everything", comment: "safety" })}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Section>
  );
}
