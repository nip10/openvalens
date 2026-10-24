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
import { Card, CardContent, CardHeader, CardTitle } from "@openvalens/ui/components/card";
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
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { AboutSection } from "@/components/about-section";
import { AiConsentSection } from "@/components/ai-consent-section";
import { AnalyticsConsentSection } from "@/components/analytics-consent-section";
import { InsightNotificationsSection } from "@/components/insight-notifications-section";
import { LanguageSection } from "@/components/language-section";
import { OidcConnectSection } from "@/components/oidc-connect-section";
import { ProfileSummarySection } from "@/components/profile-summary-card";
import { authClient } from "@/lib/auth-client";
import { prepareOfflineSignOut } from "@/utils/sync-engine";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold">
        <Trans>Settings</Trans>
      </h1>
      <div className="grid gap-6">
        <AccountSection />
        <LanguageSection />
        <OidcConnectSection />
        <ProfileSummarySection />
        <InsightNotificationsSection />
        <AnalyticsConsentSection />
        <CoachSection />
        <AiConsentSection />
        <DeleteAccountSection />
        <AboutSection />
      </div>
    </div>
  );
}

function AccountSection() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) return <Skeleton className="h-24 w-full" />;
  if (!session) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Account</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between">
        <div>
          <div className="font-medium">{session.user.name ?? session.user.email}</div>
          {session.user.email && (
            <div className="font-mono text-sm text-muted-foreground">{session.user.email}</div>
          )}
        </div>
        <Button
          variant="destructive"
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
      </CardContent>
    </Card>
  );
}

function CoachSection() {
  const queryClient = useQueryClient();
  const config = useQuery(orpc.coach.getConfig.queryOptions({ input: undefined }));

  if (config.isPending) return <Skeleton className="h-64 w-full" />;
  if (config.isError || !config.data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>
            <Trans>Coach</Trans>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            <Trans>Could not load coach settings.</Trans>{" "}
            <button className="underline" onClick={() => void config.refetch()}>
              <Trans>Retry</Trans>
            </button>
          </p>
        </CardContent>
      </Card>
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
    <Card>
      <CardHeader>
        <CardTitle>
          <Trans>Coach</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
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
          label={t`Assertiveness · ${assertivenessText(assertiveness)}`}
          hint={t`1 = very gentle, 5 = very forceful. Currently ${assertiveness} of 5.`}
        >
          <Select
            value={String(assertiveness)}
            onValueChange={(Value) => setAssertiveness(Number(Value) as 1 | 2 | 3 | 4 | 5)}
          >
            <SelectTrigger>
              <SelectValue>{`${assertiveness} · ${assertivenessText(assertiveness)}`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {`${value} · ${assertivenessText(value)}`}
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

        <div className="flex items-center gap-3">
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
      </CardContent>
    </Card>
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
      <Label className="text-sm font-medium">{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/**
 * "Delete everything" (Issue #89): preview, export-first link, co-owner
 * blockers, fresh sign-in via magic link, typed confirmation, then sign-out.
 */
function DeleteAccountSection() {
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

  if (preview.isPending) return <Skeleton className="h-40 w-full" />;
  if (preview.isError || !preview.data) return null;
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
    <Card className="border-destructive/40">
      <CardHeader>
        <CardTitle>
          <Trans>Delete account and all data</Trans>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 text-sm">
        <p>
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
            <Link to="/exports" className="underline">
              Download an export first
            </Link>
            .
          </Trans>
        </p>

        {data.blockers.length > 0 ? (
          <p className="text-destructive">
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
            <div>
              <Button variant="outline" onClick={sendSignInLink} disabled={linkSent}>
                {linkSent ? t`Sign-in link sent — check your email` : t`Email me a sign-in link`}
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2">
            <label htmlFor="delete-confirmation">
              <Trans comment="safety">
                Type <span className="font-mono font-semibold">{confirmationPhrase}</span> to
                confirm
              </Trans>
            </label>
            <div className="flex gap-2">
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
      </CardContent>
    </Card>
  );
}
