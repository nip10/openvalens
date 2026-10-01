import { useQuery } from "@tanstack/react-query";

import { orpc } from "./orpc";

/**
 * Typed oRPC query for the public readiness probe.
 */
export function useHealthReadiness() {
  return useQuery(orpc.health.readiness.queryOptions({ input: {} }));
}

/**
 * Typed oRPC query for an authenticated echo round-trip.
 */
export function useProtectedEcho(message: string) {
  return useQuery(orpc.example.protectedEcho.queryOptions({ input: { message } }));
}
