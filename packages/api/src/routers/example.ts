import { z } from "zod";

import { publicProcedure, tenantScopedProcedure, validateInput } from "../index";

const echoInput = z.object({
  message: z.string().min(1).max(500),
});

const echoOutput = z.object({
  message: z.string(),
  userId: z.string().nullable(),
  correlationId: z.string(),
});

const protectedEchoOutput = echoOutput.extend({
  targetId: z.string(),
});

/**
 * Infrastructure round-trip example (Issue #8).
 *
 * `echo` proves publicProcedure + Zod input/output + correlation-id
 * propagation; `protectedEcho` proves the RBAC-aware `tenantScopedProcedure`
 * end-to-end (Issue #10): the permission guard, the tenant boundary and the
 * post-handler audit write. Neither is a domain procedure — Phase 3 owns those.
 */
export const exampleRouter = {
  echo: publicProcedure
    .use(validateInput(echoInput))
    .input(echoInput)
    .output(echoOutput)
    .handler(({ input, context }) => ({
      message: input.message,
      userId: context.session?.user?.id ?? null,
      correlationId: context.correlationId,
    })),

  protectedEcho: tenantScopedProcedure({
    resource: "records",
    action: "read",
    auditAction: "RECORD_CREATED",
    targetType: "record",
  })
    .use(validateInput(echoInput))
    .input(echoInput)
    .output(protectedEchoOutput)
    .handler(({ input, context }) => ({
      message: input.message,
      userId: context.session?.user?.id ?? null,
      correlationId: context.correlationId,
      // Demonstrates audit `targetId` extraction from the handler output.
      targetId: "demo-target-1",
    })),
};
