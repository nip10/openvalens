import { z } from "zod";

import { permissionedProcedure, publicProcedure, validateInput } from "../index";

const echoInput = z.object({
  message: z.string().min(1).max(500),
});

const echoOutput = z.object({
  message: z.string(),
  userId: z.string().nullable(),
  correlationId: z.string(),
});

/**
 * Infrastructure round-trip example (Issue #8).
 *
 * `echo` proves publicProcedure + Zod input/output + correlation-id
 * propagation; `protectedEcho` proves the RBAC-aware `permissionedProcedure`
 * end-to-end. Neither is a domain procedure — Phase 3 owns those.
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

  protectedEcho: permissionedProcedure({ resource: "records", action: "read" })
    .use(validateInput(echoInput))
    .input(echoInput)
    .output(echoOutput)
    .handler(({ input, context }) => ({
      message: input.message,
      userId: context.session?.user?.id ?? null,
      correlationId: context.correlationId,
    })),
};
