/**
 * Issue #58: instance administration read-only view contract.
 *
 * This file is dependency-free so it can be imported by tests without pulling
 * in the RPC client / Varlock setup. Types are derived from the typed
 * AppRouterClient contract exported by `@openvalens/api`.
 */
import type { InferClientOutputs } from "@orpc/client";
import type { AppRouterClient } from "@openvalens/api/routers/index";

type AdminSettingsOutputs = InferClientOutputs<AppRouterClient>["adminSettings"];

export type AdminAccessOutput = AdminSettingsOutputs["access"];

export type AdminConfigurationOutput = AdminSettingsOutputs["configuration"];

export type AdminConfigurationEntry = AdminConfigurationOutput["entries"][number];

export function adminAccessQueryKey(userId: string) {
  return ["admin-settings", "access", userId] as const;
}

export function adminConfigurationQueryKey(userId: string) {
  return ["admin-settings", "configuration", userId] as const;
}
