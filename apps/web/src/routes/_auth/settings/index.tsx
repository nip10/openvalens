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
import {
  Bell,
  ChevronRight,
  CreditCard,
  Download,
  Info,
  LayoutGrid,
  Megaphone,
  type LucideIcon,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  UserRound,
  Utensils,
  Watch,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { toast } from "sonner";

import { AboutSection } from "@/components/about-section";
import { AiAppsSettingsSection, useAiAppsEnabled } from "@/components/ai-apps-settings-section";
import { AiConsentSection } from "@/components/ai-consent-section";
import { AiWorkspaceConsentSection } from "@/components/ai-workspace-consent-section";
import { AnalyticsConsentSection } from "@/components/analytics-consent-section";
import { InsightNotificationsSection } from "@/components/insight-notifications-section";
import { LanguageSection } from "@/components/language-section";
import { SetupCardSetting } from "@/components/onboarding/finish-setup-card";
import { HealthDataConsentStatus } from "@/components/health-data-consent-status";
import { SignInMethodsSection } from "@/components/sign-in-methods-section";
import { AppearanceSection } from "@/components/appearance-section";
import { CoachIcon } from "@/components/coach-icon";
import { ErrorState, InfoTip, Page, PageHeader, Section } from "@/components/page";
import { ProfileSummarySection } from "@/components/profile-summary-card";
import { DisplayNameField } from "@/components/display-name-field";
import { SettingsGroup, SettingsIcon } from "@/components/settings-rows";
import { authClient } from "@/lib/auth-client";
import { avatarInitial, displayNameOf } from "@/utils/display-name";
import { prepareOfflineSignOut } from "@/utils/sync-engine";
import { orpc } from "@/utils/orpc";
import { signUpOptionsQueryOptions } from "@/utils/sign-up";

export const Route = createFileRoute("/_auth/settings/")({
  component: SettingsPage,
});

const LINK =
  "underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:decoration-2";

/** One block of a settings category. `id` and `label` make it an entry in the index. */
type SettingsBlock = { key: string; id?: string; label?: string; node: ReactNode };

/** A settings category: one heading, then its blocks. */
type SettingsCategory = { id: string; label: string; icon: LucideIcon; blocks: SettingsBlock[] };

/**
 * #settings-0 — the settings in six categories. This list is the one place
 * that orders the page and both indexes (the sticky one on wide screens, the
 * chips on phones): add a setting by adding a block to its category.
 */
function useSettingsCategories(): SettingsCategory[] {
  const { t, i18n } = useLingui();
  // Issue #297 — Plan & billing exists only on OpenValens Cloud.
  const cloud = useQuery(signUpOptionsQueryOptions()).data?.mode === "cloud";
  // Usage analytics hides when the server has it off and sharing is already
  // off (the section hides itself too); the index entry follows.
  const analytics = useQuery(orpc.analytics.getPreference.queryOptions({ input: {} })).data;
  const showAnalytics = !analytics || analytics.available || analytics.enabled;
  // Issue #439 — hidden entirely while the server has AI apps off.
  const showAiApps = useAiAppsEnabled();

  const when = (show: boolean, block: SettingsBlock): SettingsBlock[] => (show ? [block] : []);

  return [
    {
      id: "account",
      label: t`Account`,
      icon: UserRound,
      blocks: [
        { key: "account", node: <AccountSection /> },
        ...when(cloud, {
          key: "plan",
          id: "plan",
          label: t`Plan & billing`,
          node: (
            <LinkRows>
              <IntegrationLink
                to="/settings/billing"
                icon={CreditCard}
                label={<Trans>Plan & billing</Trans>}
                description={<Trans>Your free trial and plan</Trans>}
              />
            </LinkRows>
          ),
        }),
        // No index entry: the section hides itself when there is nothing to link.
        { key: "sign-in", id: "sign-in", node: <SignInMethodsSection /> },
        {
          key: "profile",
          id: "profile",
          label: t`Profile`,
          node: (
            <div className="grid gap-4">
              <ProfileSummarySection />
              <SetupCardSetting />
            </div>
          ),
        },
      ],
    },
    {
      id: "preferences",
      label: t`Preferences`,
      icon: SlidersHorizontal,
      blocks: [
        { key: "language", id: "language", label: t`Language`, node: <LanguageSection /> },
        {
          key: "appearance",
          id: "appearance",
          label: t`Appearance`,
          node: <AppearanceSection />,
        },
        {
          key: "modules",
          id: "modules",
          label: t`Modules and devices`,
          node: (
            <LinkRows>
              <IntegrationLink
                to="/settings/modules"
                icon={LayoutGrid}
                label={<Trans>Modules</Trans>}
                description={<Trans>Choose the parts of the app you use.</Trans>}
              />
              <IntegrationLink
                to="/settings/nutrition"
                icon={Utensils}
                label={<Trans>Nutrition</Trans>}
                description={<Trans>How the food screens look and what they offer.</Trans>}
              />
              <IntegrationLink
                to="/settings/devices"
                icon={Watch}
                label={<Trans>Devices</Trans>}
                description={<Trans>Apple Health or Health Connect, through the mobile app</Trans>}
              />
            </LinkRows>
          ),
        },
        {
          key: "whats-new",
          id: "whats-new",
          label: t`What's new`,
          node: (
            <LinkRows>
              <IntegrationLink
                to="/settings/whats-new"
                icon={Megaphone}
                label={<Trans>What's new</Trans>}
                description={<Trans>Every update, newest first</Trans>}
              />
            </LinkRows>
          ),
        },
      ],
    },
    {
      id: "notifications",
      label: t`Notifications`,
      icon: Bell,
      blocks: [
        {
          key: "notifications",
          label: i18n._(INSIGHT_DELIVERY_COPY.settingsTitle),
          node: <InsightNotificationsSection />,
        },
      ],
    },
    {
      id: "ai",
      label: t`AI`,
      icon: Sparkles,
      blocks: [
        { key: "coach", id: "coach", label: t`Coach`, node: <CoachSection /> },
        {
          key: "ai-workspace",
          id: "ai-workspace",
          label: t`AI for this workspace`,
          node: <AiWorkspaceConsentSection />,
        },
        {
          key: "ai-processing",
          id: "ai-processing",
          label: t`AI processing`,
          node: <AiConsentSection />,
        },
        ...when(showAiApps, {
          key: "ai-apps",
          id: "ai-apps",
          label: t`Connected AI apps`,
          node: <AiAppsSettingsSection />,
        }),
      ],
    },
    {
      id: "privacy",
      label: t`Privacy & data`,
      icon: ShieldCheck,
      blocks: [
        {
          key: "consent",
          id: "health-consent",
          label: t`Health data consent`,
          node: <HealthDataConsentStatus />,
        },
        ...when(showAnalytics, {
          key: "analytics",
          id: "analytics",
          label: t`Usage analytics`,
          node: <AnalyticsConsentSection />,
        }),
        {
          key: "export",
          node: (
            <LinkRows>
              <IntegrationLink
                to="/exports"
                icon={Download}
                label={<Trans>Export your data</Trans>}
                description={<Trans>For a doctor, a backup or another app</Trans>}
              />
            </LinkRows>
          ),
        },
        {
          key: "delete",
          id: "delete-account",
          label: t`Delete account`,
          node: <DeleteAccountSection />,
        },
      ],
    },
    {
      id: "about",
      label: t`About`,
      icon: Info,
      blocks: [{ key: "about", node: <AboutSection bare /> }],
    },
  ];
}

const INDEX_LINK =
  "block rounded-full px-3 py-1.5 text-sm text-ink-2 transition-colors duration-[var(--dur-short)] hover:bg-paper-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function SettingsPage() {
  const { t } = useLingui();
  const categories = useSettingsCategories();

  return (
    <Page>
      <div className="grid gap-4">
        <PageHeader title={<Trans>Settings</Trans>} />
        {/* #settings-1 — on phones, the six categories as jump links under the title. */}
        <nav aria-label={t`Settings categories`} className="lg:hidden">
          <ul className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <li key={category.id}>
                <a
                  href={`#${category.id}`}
                  className="inline-flex min-h-9 items-center gap-1.5 rounded-full border border-rule bg-sheet px-3 text-sm font-medium text-ink-2 no-underline transition-colors duration-[var(--dur-short)] hover:bg-paper-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                >
                  <category.icon className="size-4 text-ink-3" aria-hidden="true" />
                  {category.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="grid gap-10 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-14">
        <nav aria-label={t`Settings`} className="hidden lg:block">
          <ul className="sticky top-10 grid gap-3">
            {categories.map((category) => (
              <li key={category.id} className="grid gap-0.5">
                <a href={`#${category.id}`} className={`${INDEX_LINK} font-semibold text-ink`}>
                  {category.label}
                </a>
                <ul className="grid gap-0.5 pl-3">
                  {category.blocks
                    .filter((block) => block.id && block.label)
                    .map((block) => (
                      <li key={block.key}>
                        <a href={`#${block.id}`} className={INDEX_LINK}>
                          {block.label}
                        </a>
                      </li>
                    ))}
                </ul>
              </li>
            ))}
          </ul>
        </nav>
        <div className="grid min-w-0 max-w-3xl content-start gap-14">
          {categories.map((category) => (
            <section
              key={category.id}
              id={category.id}
              aria-labelledby={`${category.id}-heading`}
              className="grid scroll-mt-10 content-start gap-8"
            >
              <h2
                id={`${category.id}-heading`}
                className="flex items-center gap-2.5 border-b border-rule pb-3 text-2xl leading-tight text-ink"
              >
                <category.icon className="size-5 shrink-0 text-ink-3" aria-hidden="true" />
                {category.label}
              </h2>
              {category.blocks.map((block) => (
                <div key={block.key} id={block.id} className="min-w-0 scroll-mt-10 empty:hidden">
                  {block.node}
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </Page>
  );
}

/** #settings-5 — link-out rows in one card with no heading above, so each title shows once. */
function LinkRows({ children }: { children: ReactNode }) {
  return <SettingsGroup className="px-0">{children}</SettingsGroup>;
}

function IntegrationLink({
  to,
  icon,
  label,
  description,
}: {
  to:
    | "/settings/devices"
    | "/settings/modules"
    | "/settings/nutrition"
    | "/settings/billing"
    | "/settings/whats-new"
    | "/exports";
  icon: LucideIcon;
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

/** #settings-4 — the name once (or the email once), a way to set the name, and sign out. */
function AccountSection() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <Skeleton className="h-24 w-full rounded-3xl" />;
  if (!session) return null;
  const name = displayNameOf(session.user.name, session.user.email);

  return (
    <SettingsGroup>
      <div className="flex flex-wrap items-center gap-4 py-4">
        <span
          className="grid size-12 shrink-0 place-items-center rounded-full bg-sidebar-accent font-display text-xl font-medium text-signal"
          aria-hidden="true"
        >
          {avatarInitial(session.user.name, session.user.email)}
        </span>
        <div className="grid min-w-0 flex-1 basis-40 gap-0.5">
          <span className="font-display text-lg font-medium break-all text-ink">
            {name ?? session.user.email}
          </span>
          {name && session.user.email ? (
            <span className="text-sm break-all text-ink-3">{session.user.email}</span>
          ) : null}
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
      <div className="py-3 text-sm">
        <DisplayNameField showCurrent={false} />
      </div>
    </SettingsGroup>
  );
}

function CoachSection() {
  const queryClient = useQueryClient();
  const config = useQuery(orpc.coach.getConfig.queryOptions({ input: undefined }));

  if (config.isPending) return <Skeleton className="h-64 w-full rounded-3xl" />;
  if (config.isError || !config.data) {
    return (
      <Section title={<Trans>Coach</Trans>} icon={CoachIcon} tone="signal">
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

type CoachConfig = {
  tone: CoachTone;
  assertiveness: number;
  riskTolerance: CoachRiskTolerance;
  medicalDisclaimerMode: CoachDisclaimerMode;
  selectedTemplateKey: CoachTemplateId;
};

function configFrom(profile: CoachProfileLike): CoachConfig {
  return {
    tone: profile.tone,
    assertiveness: profile.assertiveness,
    riskTolerance: profile.riskTolerance,
    medicalDisclaimerMode: profile.medicalDisclaimerMode,
    selectedTemplateKey: profile.selectedTemplateKey,
  };
}

/**
 * #settings-7 — each Coach choice saves as soon as it changes, with a toast,
 * like every other setting on the page. A failed save goes back to the
 * saved value.
 */
function CoachForm({ initial, onSaved }: { initial: CoachProfileLike; onSaved: () => void }) {
  const [config, setConfig] = useState<CoachConfig>(() => configFrom(initial));
  const { t, i18n } = useLingui();
  const hint = (message: MessageDescriptor | null) => (message ? i18n._(message) : undefined);
  const assertivenessText = (value: number) => i18n._(assertivenessLabel(value));

  useEffect(() => {
    setConfig(configFrom(initial));
  }, [initial]);

  const save = useMutation(
    orpc.coach.upsertConfig.mutationOptions({
      onSuccess: () => {
        toast.success(t`Coach settings saved`);
        onSaved();
      },
      onError: () => {
        toast.error(t`Could not save. Try again.`);
        setConfig(configFrom(initial));
      },
    }),
  );

  const change = (patch: Partial<CoachConfig>) => {
    const next = { ...config, ...patch };
    setConfig(next);
    save.mutate(next);
  };
  const { tone, assertiveness, riskTolerance: risk, medicalDisclaimerMode: disclaimer } = config;
  const template = config.selectedTemplateKey;

  return (
    <Section title={<Trans>Coach</Trans>} icon={CoachIcon} tone="signal" sheet>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label={t`Tone`} hint={hint(toneDescription(tone))}>
          <Select
            value={tone}
            disabled={save.isPending}
            onValueChange={(value) => change({ tone: value as CoachTone })}
          >
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

        <Field label={t`Assertiveness`} hint={t`1 is very gentle, 5 is very forceful.`}>
          <Select
            value={String(assertiveness)}
            disabled={save.isPending}
            onValueChange={(value) => change({ assertiveness: Number(value) as 1 | 2 | 3 | 4 | 5 })}
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
          <Select
            value={risk}
            disabled={save.isPending}
            onValueChange={(value) => change({ riskTolerance: value as CoachRiskTolerance })}
          >
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
            disabled={save.isPending}
            onValueChange={(value) =>
              change({ medicalDisclaimerMode: value as CoachDisclaimerMode })
            }
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

        <Field
          label={t`Coaching focus`}
          hint={t`What the coach plans around. You can change it at any time.`}
        >
          <Select
            value={template}
            disabled={save.isPending}
            onValueChange={(value) => change({ selectedTemplateKey: value as CoachTemplateId })}
          >
            <SelectTrigger>
              <SelectValue>{i18n._(templateLabel(template))}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COACH_TEMPLATE_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  <span className="grid gap-0.5">
                    <span>{i18n._(templateLabel(value))}</span>
                    {templateDescription(value) ? (
                      <span className="text-xs text-ink-3">{hint(templateDescription(value))}</span>
                    ) : null}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {templateDescription(template) ? (
            <p className="text-sm text-ink-3">{hint(templateDescription(template))}</p>
          ) : null}
        </Field>
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
      <Section title={<Trans>Delete account and all data</Trans>} icon={Trash2} tone="neutral">
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
    <Section title={<Trans>Delete account and all data</Trans>} icon={Trash2} tone="neutral">
      <div className="sheet grid gap-4 p-5">
        <p className="max-w-[65ch] text-ink-2">
          {organizationCount === 1 ? (
            <Trans comment="safety">
              This permanently deletes your account and all {rows} records in your health record. It
              can't be undone.
            </Trans>
          ) : organizationCount > 0 ? (
            <Trans comment="safety">
              This permanently deletes your account and all {rows} records across{" "}
              {organizationCount} health records ({organizationNames}). It can't be undone.
            </Trans>
          ) : (
            <Trans comment="safety">
              This permanently deletes your account and all {rows} records. It can't be undone.
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
