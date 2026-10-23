import { useLingui } from "@lingui/react/macro";
import { useMutation, useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AdminInvitationsView } from "@/components/admin-invitations-view";
import { authClient } from "@/lib/auth-client";
import { isConfigPermissionDenied } from "@/utils/admin-settings-error";
import { classifyAdmissionError } from "@/utils/admission-error";
import { adminAccessQueryOptions } from "@/utils/admin-settings";
import {
  admissionIssueInvitationMutationOptions,
  admissionListInvitationsQueryOptions,
  admissionRevokeInvitationMutationOptions,
} from "@/utils/admission";

export const Route = createFileRoute("/_auth/admin/invitations")({
  component: AdminInvitationsPage,
});

type IssueState = "idle" | "loading" | "success" | "error";

function AdminInvitationsPage() {
  const { data: session, isPending: sessionPending } = authClient.useSession();
  const userId = session?.user?.id;
  const hasUserId = !!userId;

  const access = useQuery({
    ...adminAccessQueryOptions(userId ?? ""),
    enabled: hasUserId,
  });

  const list = useQuery({
    ...admissionListInvitationsQueryOptions(userId ?? ""),
    enabled: hasUserId && access.data?.isInstanceAdmin === true,
  });

  const issue = useMutation(admissionIssueInvitationMutationOptions());
  const revoke = useMutation(admissionRevokeInvitationMutationOptions());

  const [issueState, setIssueState] = useState<IssueState>("idle");
  const [issueError, setIssueError] = useState<string | null>(null);
  const { t } = useLingui();

  useEffect(() => {
    if (issueState !== "success") return;
    const id = setTimeout(() => setIssueState("idle"), 3_000);
    return () => clearTimeout(id);
  }, [issueState]);

  async function handleIssue(email: string) {
    setIssueState("loading");
    setIssueError(null);
    try {
      await issue.mutateAsync({ email });
      setIssueState("success");
      void list.refetch();
    } catch (error) {
      setIssueState("error");
      setIssueError(
        classifyAdmissionError(error) === "email_unavailable"
          ? t`This server can't send email yet. Add a Resend key, then invite again.`
          : t`Could not send invitation.`,
      );
      if (isConfigPermissionDenied(error)) {
        void access.refetch();
      }
    }
  }

  async function handleRevoke(invitationId: string) {
    try {
      await revoke.mutateAsync({ invitationId });
      void list.refetch();
    } catch (error) {
      if (isConfigPermissionDenied(error)) {
        void access.refetch();
      }
      throw error;
    }
  }

  if (sessionPending) {
    return <AdminInvitationsView accessState="loading" />;
  }
  if (!hasUserId) {
    return <AdminInvitationsView accessState="denied" />;
  }

  if (access.isPending || access.isFetching) {
    return <AdminInvitationsView accessState="loading" />;
  }

  if (access.isError) {
    return <AdminInvitationsView accessState="error" onRetryAccess={() => void access.refetch()} />;
  }

  if (!access.data?.isInstanceAdmin) {
    return <AdminInvitationsView accessState="denied" />;
  }

  return (
    <AdminInvitationsView
      accessState="granted"
      listState={list.isPending || list.isFetching ? "loading" : list.isError ? "error" : "ready"}
      invitations={list.data?.invitations}
      issueState={issueState}
      issueError={issueError}
      onRetryList={() => void list.refetch()}
      onIssue={handleIssue}
      onRevoke={handleRevoke}
    />
  );
}
