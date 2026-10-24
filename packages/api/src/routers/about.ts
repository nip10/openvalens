import { z } from "zod";

import { publicProcedure } from "../index";
import { SOURCE_LICENSE, UPSTREAM_SOURCE_CODE_URL } from "../source-code";

/**
 * Issue #56 — `about` RPC namespace.
 *
 * `info` is a public read the settings screens use to link to this instance's
 * source code, which AGPL-3.0 section 13 requires a network service to offer.
 * It carries only the licence id and the operator's `SOURCE_CODE_URL`.
 */
const infoOutput = z.object({
  license: z.literal(SOURCE_LICENSE),
  sourceCodeUrl: z.url(),
});

export const aboutRouter = {
  info: publicProcedure
    .input(z.object({}))
    .output(infoOutput)
    .handler(async ({ context }) => ({
      license: SOURCE_LICENSE,
      sourceCodeUrl: context.sourceCodeUrl ?? UPSTREAM_SOURCE_CODE_URL,
    })),
};
