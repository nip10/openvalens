import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import {
  buildSectionPatch,
  describeProfileSaveError,
  dirtySections,
  draftFromSnapshot,
  nextSetupSection,
  rebaseDraft,
  resetSection,
  SECTION_TITLES,
  SETUP_SECTIONS,
  setupProgress,
  type SetupSection,
  type WellnessProfileDraft,
} from "@openvalens/api/presenters/wellness-profile";
import {
  FOCUS_AREA_LABELS,
  PROFILE_INTRO,
  PROFILE_OFFLINE_NOTE,
  PROFILE_STORAGE_NOTE,
  type WellnessProfileSnapshot,
  type WellnessProfileUpdateInput,
} from "@openvalens/api/wellness-profile-contract";
import { Button } from "@openvalens/ui/components/button";
import { Input } from "@openvalens/ui/components/input";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

import { ArrowRight, ListChecks, WifiOff } from "lucide-react";

import { ErrorState, Meter, Page, PageHeader, ToneIcon } from "@/components/page";
import {
  StepHead,
  WellnessProfileEditor,
  type SectionSaveState,
} from "@/components/wellness-profile-editor";
import { orpc } from "@/utils/orpc";
import { useUpdateWellnessProfile, useWellnessProfile } from "@/utils/wellness-profile";

export const Route = createFileRoute("/_auth/profile")({
  component: ProfilePage,
  validateSearch: (search: Record<string, unknown>): { section?: SetupSection } => ({
    section: SETUP_SECTIONS.includes(search.section as SetupSection)
      ? (search.section as SetupSection)
      : undefined,
  }),
});

function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine !== false,
  );
  useEffect(() => {
    const update = () => setOnline(navigator.onLine !== false);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}

function ProfilePage() {
  const profile = useWellnessProfile();

  if (profile.isPending) {
    return (
      <Page>
        <PageHeader title={<Trans>Your profile</Trans>} />
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
          <Skeleton className="h-96 w-full rounded-3xl" />
          <Skeleton className="hidden h-40 w-full rounded-3xl lg:block" />
        </div>
      </Page>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <Page width="narrow">
        <PageHeader title={<Trans>Your profile</Trans>} />
        <ErrorState
          title={<Trans>Could not load your profile. Nothing has changed.</Trans>}
          action={
            <Button onClick={() => void profile.refetch()}>
              <Trans>Retry</Trans>
            </Button>
          }
        />
      </Page>
    );
  }
  return (
    <ProfileEditorPage
      snapshot={profile.data}
      userId={profile.userId}
      reload={() => profile.refetch()}
    />
  );
}

function ProfileEditorPage({
  snapshot,
  userId,
  reload,
}: {
  snapshot: WellnessProfileSnapshot;
  userId: string;
  reload: () => Promise<{ data?: WellnessProfileSnapshot }>;
}) {
  const navigate = useNavigate();
  const { section: requestedSection } = Route.useSearch();
  const online = useOnline();
  const update = useUpdateWellnessProfile(userId);
  const [draft, setDraft] = useState<WellnessProfileDraft>(() => draftFromSnapshot(snapshot));
  const [birthYearText, setBirthYearText] = useState(() =>
    snapshot.birthYear.state === "recorded" ? String(snapshot.birthYear.value) : "",
  );
  const [saveState, setSaveState] = useState<Partial<Record<SetupSection, SectionSaveState>>>({});
  const [pageMessage, setPageMessage] = useState<MessageDescriptor | null>(null);
  const baseline = useRef(snapshot);
  const { t, i18n } = useLingui();

  // Follow server snapshots (saves, refetches, conflict reloads) without
  // dropping unsaved edits in other sections.
  useEffect(() => {
    if (baseline.current === snapshot) return;
    setDraft((current) => rebaseDraft(baseline.current, snapshot, current));
    baseline.current = snapshot;
  }, [snapshot]);

  const dirty = dirtySections(snapshot, draft);

  useBlocker({
    shouldBlockFn: () =>
      dirty.length > 0 &&
      !window.confirm(t`You have unsaved changes on this page. Leave without saving them?`),
    enableBeforeUnload: () => dirty.length > 0,
  });

  useEffect(() => {
    const target = requestedSection ?? null;
    if (target) document.getElementById(`section-${target}`)?.scrollIntoView({ block: "start" });
  }, [requestedSection]);

  const send = async (input: WellnessProfileUpdateInput) => {
    const withStatus: WellnessProfileUpdateInput =
      snapshot.setupStatus === null && input.setupStatus === undefined
        ? { ...input, setupStatus: "in_progress" }
        : input;
    return update.mutateAsync(withStatus);
  };

  const onSave = async (section: SetupSection) => {
    const patch = buildSectionPatch(snapshot, draft, section);
    if (!patch) return;
    setSaveState((s) => ({ ...s, [section]: { status: "saving" } }));
    try {
      await send(patch);
      setSaveState((s) => ({ ...s, [section]: { status: "saved" } }));
    } catch (error) {
      const described = describeProfileSaveError(error);
      if (described.kind === "conflict") await reload();
      setSaveState((s) => ({
        ...s,
        [section]: { status: "error", message: described.message },
      }));
    }
  };

  const finish = async (setupStatus: "completed" | "skipped") => {
    setPageMessage(null);
    try {
      if (snapshot.setupStatus !== setupStatus) {
        await send({ expectedRevision: snapshot.revision, setupStatus });
      }
      await navigate({ to: "/dashboard", ignoreBlocker: setupStatus === "skipped" });
    } catch (error) {
      setPageMessage(describeProfileSaveError(error).message);
    }
  };

  const progress = setupProgress(snapshot);
  const resume = nextSetupSection(snapshot);
  const inSetup = snapshot.setupStatus !== "completed";

  return (
    <Page>
      <PageHeader
        title={<Trans>Your profile</Trans>}
        description={<Trans>All optional. Answer what helps you.</Trans>}
        info={
          <>
            <p>{PROFILE_INTRO}</p>
            <p>{PROFILE_STORAGE_NOTE}</p>
          </>
        }
        actions={
          inSetup ? (
            <>
              <Button variant="outline" onClick={() => void finish("skipped")}>
                <Trans>Skip for now</Trans>
              </Button>
              <Button onClick={() => void finish("completed")} disabled={dirty.length > 0}>
                <Trans>Done</Trans>
              </Button>
            </>
          ) : (
            <Link
              to="/settings"
              className="font-display text-sm font-medium text-ink underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:decoration-2"
            >
              <Trans>Back to settings</Trans>
            </Link>
          )
        }
      />

      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <aside className="grid gap-3 text-sm lg:sticky lg:top-10 lg:col-start-2 lg:row-start-1">
          <div className="sheet grid gap-3 p-5">
            <div className="flex items-center gap-3">
              <ToneIcon icon={ListChecks} tone="signal" />
              <p className="font-display font-medium text-ink">
                <Trans>
                  {progress.answered} of {progress.available} sections answered
                </Trans>
              </p>
            </div>
            <Meter
              value={progress.available > 0 ? progress.answered / progress.available : 0}
              tone="signal"
            />
            {resume ? (
              <a
                href={`#section-${resume}`}
                className="inline-flex w-fit items-center gap-1.5 font-medium text-ink-2 underline decoration-signal underline-offset-[0.15em] hover:decoration-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:decoration-2"
              >
                <Trans>Next unanswered: {i18n._(SECTION_TITLES[resume])}</Trans>
                <ArrowRight className="size-4 shrink-0" aria-hidden="true" />
              </a>
            ) : null}
            {dirty.length > 0 ? (
              <p className="text-ink-3">
                <Trans>Unsaved: {dirty.map((s) => i18n._(SECTION_TITLES[s])).join(", ")}</Trans>
              </p>
            ) : null}
          </div>
          {pageMessage ? (
            <p role="alert" className="text-destructive">
              {i18n._(pageMessage)}
            </p>
          ) : null}
          {!online ? (
            <p
              role="status"
              className="flex items-start gap-2 rounded-2xl bg-warning/14 px-4 py-3 text-ink-2"
            >
              <WifiOff className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
              <span>
                <Trans>You are offline.</Trans> {PROFILE_OFFLINE_NOTE}
              </span>
            </p>
          ) : null}
        </aside>

        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <WellnessProfileEditor
            snapshot={snapshot}
            draft={draft}
            onDraftChange={(next) => {
              setDraft(next);
              setSaveState({});
            }}
            birthYearText={birthYearText}
            onBirthYearTextChange={setBirthYearText}
            saveState={saveState}
            onSave={(section) => void onSave(section)}
            onUndo={(section) => {
              setDraft((current) => resetSection(snapshot, current, section));
              if (section === "ageAndSex") {
                setBirthYearText(
                  snapshot.birthYear.state === "recorded" ? String(snapshot.birthYear.value) : "",
                );
              }
            }}
            goalSection={<GoalSection draft={draft} />}
            now={new Date()}
          />
        </div>
      </div>
    </Page>
  );
}

/**
 * Optional goal step. Goals live in the existing Goals feature (one source of
 * truth); this only offers a shortcut to add one and never sets a target for
 * the person.
 */
function GoalSection({ draft }: { draft: WellnessProfileDraft }) {
  const queryClient = useQueryClient();
  const inputId = useId();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: MessageDescriptor } | null>(null);
  const { t, i18n } = useLingui();
  const add = useMutation(
    orpc.plans.goals.upsertGoal.mutationOptions({
      onSuccess: () => {
        setTitle("");
        setMessage({ ok: true, text: msg`Goal added. You can edit it under Workouts.` });
        void queryClient.invalidateQueries({ queryKey: orpc.plans.goals.key() });
      },
      onError: (error) => setMessage({ ok: false, text: describeProfileSaveError(error).message }),
    }),
  );
  const focus = draft.answers.focus.state === "recorded" ? draft.answers.focus.value[0] : undefined;

  return (
    <section
      id="section-goal"
      role="region"
      aria-labelledby={`${inputId}-title`}
      className="sheet grid scroll-mt-10 gap-5 p-5 md:p-6"
    >
      <StepHead
        section="goal"
        titleId={`${inputId}-title`}
        info={
          <p>
            <Trans>
              Add a goal in your own words if you have one. It is saved to your Goals, where you can
              set a target and date later. Nothing is suggested or worked out for you.
            </Trans>
          </p>
        }
      />
      <div className="grid gap-2">
        <label htmlFor={inputId} className="text-sm text-ink-3">
          <Trans>Goal</Trans>
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={inputId}
            value={title}
            maxLength={200}
            className="max-w-md"
            placeholder={t`For example: walk most days`}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Button
            variant="outline"
            disabled={title.trim().length === 0 || add.isPending}
            onClick={() =>
              add.mutate({
                title: title.trim(),
                category: focus ? FOCUS_AREA_LABELS[focus] : "General",
                status: "not_started",
              })
            }
          >
            {add.isPending ? t`Adding…` : t`Add goal`}
          </Button>
        </div>
        {message ? (
          <p
            role={message.ok ? "status" : "alert"}
            className={message.ok ? "text-sm text-success" : "text-sm text-destructive"}
          >
            {i18n._(message.text)}
          </p>
        ) : null}
      </div>
    </section>
  );
}
