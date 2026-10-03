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
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { authClient } from "@/lib/auth-client";
import { orpc } from "@/utils/orpc";

export const Route = createFileRoute("/_auth/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold">Settings</h1>
      <div className="grid gap-6">
        <AccountSection />
        <CoachSection />
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
        <CardTitle>Account</CardTitle>
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
          onClick={() =>
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => navigate({ to: "/" }),
              },
            })
          }
        >
          Sign out
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
          <CardTitle>Coach</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Could not load coach settings.{" "}
            <button className="underline" onClick={() => void config.refetch()}>
              Retry
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
        <CardTitle>Coach</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-5">
        <Field label="Tone" hint={toneDescription(tone)}>
          <Select value={tone} onValueChange={(Value) => setTone(Value as CoachTone)}>
            <SelectTrigger>
              <SelectValue>{toneLabel(tone)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COACH_TONE_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {toneLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field
          label={`Assertiveness · ${assertivenessLabel(assertiveness)}`}
          hint={`1 = very gentle, 5 = very forceful. Currently ${assertiveness} of 5.`}
        >
          <Select
            value={String(assertiveness)}
            onValueChange={(Value) => setAssertiveness(Number(Value) as 1 | 2 | 3 | 4 | 5)}
          >
            <SelectTrigger>
              <SelectValue>{`${assertiveness} · ${assertivenessLabel(assertiveness)}`}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {[1, 2, 3, 4, 5].map((value) => (
                <SelectItem key={value} value={String(value)}>
                  {`${value} · ${assertivenessLabel(value)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Risk tolerance" hint={riskDescription(risk)}>
          <Select value={risk} onValueChange={(Value) => setRisk(Value as CoachRiskTolerance)}>
            <SelectTrigger>
              <SelectValue>{riskLabel(risk)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COACH_RISK_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {riskLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Medical disclaimer">
          <Select
            value={disclaimer}
            onValueChange={(Value) => setDisclaimer(Value as CoachDisclaimerMode)}
          >
            <SelectTrigger>
              <SelectValue>{disclaimerLabel(disclaimer)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COACH_DISCLAIMER_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {disclaimerLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <Field label="Template" hint={templateDescription(template)}>
          <Select value={template} onValueChange={(Value) => setTemplate(Value as CoachTemplateId)}>
            <SelectTrigger>
              <SelectValue>{templateLabel(template)}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {COACH_TEMPLATE_VALUES.map((value) => (
                <SelectItem key={value} value={value}>
                  {templateLabel(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          {save.isSuccess && !dirty ? (
            <span className="text-sm text-success">Saved</span>
          ) : save.isError ? (
            <span className="text-sm text-destructive">Could not save.</span>
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
