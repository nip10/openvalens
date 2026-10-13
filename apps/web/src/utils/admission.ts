import { orpc } from "./orpc";

export type {
  AdmissionStatusOutput,
  AdmissionBeginOutput,
  AdmissionCompleteOutput,
  AdmissionIssueOutput,
  AdmissionRevokeOutput,
  AdmissionListOutput,
  AdmissionInvitationSummary,
  AdmissionKind,
} from "./admission-keys";

import { admissionListQueryKey, admissionStatusQueryKey } from "./admission-keys";

export function admissionStatusQueryOptions() {
  return {
    ...orpc.admission.status.queryOptions({ input: {} }),
    queryKey: [...admissionStatusQueryKey],
    staleTime: 30_000,
    retry: 1,
  };
}

export function admissionIssueInvitationMutationOptions() {
  return orpc.admission.issueInvitation.mutationOptions();
}

export function admissionRevokeInvitationMutationOptions() {
  return orpc.admission.revokeInvitation.mutationOptions();
}

export function admissionListInvitationsQueryOptions(userId: string) {
  return {
    ...orpc.admission.listInvitations.queryOptions({ input: {} }),
    queryKey: [...admissionListQueryKey(userId)],
    staleTime: 0,
    retry: 1,
  };
}
