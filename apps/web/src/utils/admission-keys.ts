/**
 * Issue #63: admission (setup + global invitation) client contract.
 *
 * This file is dependency-free so tests can import query keys and types
 * without pulling in the RPC client or Varlock setup.
 */
import type { InferClientOutputs } from "@orpc/client";
import type { AppRouterClient } from "@openvalens/api/routers/index";

type AdmissionOutputs = InferClientOutputs<AppRouterClient>["admission"];

export type AdmissionStatusOutput = AdmissionOutputs["status"];
export type AdmissionBeginOutput = AdmissionOutputs["begin"];
export type AdmissionCompleteOutput = AdmissionOutputs["complete"];
export type AdmissionIssueOutput = AdmissionOutputs["issueInvitation"];
export type AdmissionRevokeOutput = AdmissionOutputs["revokeInvitation"];
export type AdmissionListOutput = AdmissionOutputs["listInvitations"];

export type AdmissionInvitationSummary = AdmissionListOutput["invitations"][number];

export type AdmissionKind = "setup" | "invitation";

export const admissionStatusQueryKey = ["admission", "status"] as const;

export function admissionListQueryKey(userId: string) {
  return ["admission", "invitations", userId] as const;
}
