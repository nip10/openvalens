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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@openvalens/ui/components/card";
import { Input } from "@openvalens/ui/components/input";
import { Skeleton } from "@openvalens/ui/components/skeleton";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useBlocker, useNavigate } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

import { WellnessProfileEditor, type SectionSaveState } from "@/components/wellness-profile-editor";
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
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (profile.isError || !profile.data) {
    return (
      <div className="container mx-auto max-w-3xl px-4 py-6">
        <Card>
          <CardHeader>
            <CardTitle>Your profile</CardTitle>
            <CardDescription role="alert">
              Could not load your profile. Nothing has changed.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void profile.refetch()}>Retry</Button>
          </CardContent>
        </Card>
      </div>
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
  const [pageMessage, setPageMessage] = useState<string | null>(null);
  const baseline = useRef(snapshot);

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
      !window.confirm("You have unsaved changes on this page. Leave without saving them?"),
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
    <div className="container mx-auto max-w-3xl px-4 py-6">
      <h1 className="mb-2 text-2xl font-semibold">Your profile</h1>
      <p className="mb-2 text-sm text-muted-foreground">{PROFILE_INTRO}</p>
      <p className="mb-4 text-xs text-muted-foreground">{PROFILE_STORAGE_NOTE}</p>
      {!online ? (
        <p role="status" className="mb-4 rounded-md border p-3 text-sm">
          You are offline. {PROFILE_OFFLINE_NOTE}
        </p>
      ) : null}

      <Card className="mb-6">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-6">
          <div className="text-sm">
            <div>
              {progress.answered} of {progress.available} sections answered
            </div>
            {resume ? (
              <a href={`#section-${resume}`} className="text-muted-foreground underline">
                Next unanswered: {SECTION_TITLES[resume]}
              </a>
            ) : null}
            {dirty.length > 0 ? (
              <div className="text-muted-foreground">
                Unsaved: {dirty.map((s) => SECTION_TITLES[s]).join(", ")}
              </div>
            ) : null}
          </div>
          <div className="flex gap-2">
            {inSetup ? (
              <>
                <Button variant="outline" onClick={() => void finish("skipped")}>
                  Skip for now
                </Button>
                <Button onClick={() => void finish("completed")} disabled={dirty.length > 0}>
                  Done
                </Button>
              </>
            ) : (
              <Link to="/settings" className="text-sm underline">
                Back to settings
              </Link>
            )}
          </div>
        </CardContent>
        {pageMessage ? (
          <p role="alert" className="px-6 pb-4 text-sm text-destructive">
            {pageMessage}
          </p>
        ) : null}
      </Card>

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
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const add = useMutation(
    orpc.plans.goals.upsertGoal.mutationOptions({
      onSuccess: () => {
        setTitle("");
        setMessage({ ok: true, text: "Goal added. You can edit it under Workouts." });
        void queryClient.invalidateQueries({ queryKey: orpc.plans.goals.key() });
      },
      onError: (error) => setMessage({ ok: false, text: describeProfileSaveError(error).message }),
    }),
  );
  const focus = draft.answers.focus.state === "recorded" ? draft.answers.focus.value[0] : undefined;

  return (
    <Card id="section-goal" role="region" aria-labelledby={`${inputId}-title`}>
      <CardHeader>
        <CardTitle id={`${inputId}-title`} className="text-lg">
          {SECTION_TITLES.goal}
        </CardTitle>
        <CardDescription>
          Add a goal in your own words if you have one. It is saved to your Goals, where you can set
          a target and date later. Nothing is suggested or worked out for you.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <label htmlFor={inputId} className="text-sm font-medium">
          Goal
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id={inputId}
            value={title}
            maxLength={200}
            className="max-w-md"
            placeholder="For example: walk most days"
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
            {add.isPending ? "Adding…" : "Add goal"}
          </Button>
        </div>
        {message ? (
          <p
            role={message.ok ? "status" : "alert"}
            className={message.ok ? "text-sm text-success" : "text-sm text-destructive"}
          >
            {message.text}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
