import { z } from "zod";

import { instanceAdminProcedure, raiseApiError, resolveInstanceAdminProcedure } from "../index";

/**
 * Issue #58 — global, instance-administrator read-only settings surface.
 *
 * Both procedures are session-only. `access` answers whether the *current*
 * session user is an instance administrator (always `200` with a boolean, so a
 * client can render without treating the common non-admin case as an error) and
 * therefore builds on the non-enforcing `resolveInstanceAdminProcedure`.
 * `configuration` is restricted to instance administrators via the
 * default-deny `instanceAdminProcedure`, so the handler never performs a manual
 * role check.
 *
 * Nothing here writes settings, tables or audit rows, and no configuration
 * value, user id, email or role string is ever returned.
 */

const accessOutput = z.object({
  isInstanceAdmin: z.boolean(),
});

const configurationEntryOutput = z.object({
  key: z.string(),
  configured: z.boolean(),
  sensitive: z.boolean(),
});

const configurationOutput = z.object({
  entries: z.array(configurationEntryOutput),
});

export const adminSettingsRouter = {
  access: resolveInstanceAdminProcedure
    .input(z.object({}))
    .output(accessOutput)
    .handler(({ context }) => ({ isInstanceAdmin: context.instanceAdmin })),

  configuration: instanceAdminProcedure
    .input(z.object({}))
    .output(configurationOutput)
    .handler(({ context }) => {
      const inventory = context.adminConfigInventory;
      if (!inventory) {
        throw raiseApiError("INTERNAL", "Something went wrong.");
      }

      // Project exactly the three contract fields; any extra entry field is
      // ignored rather than forwarded.
      const entries = inventory.map((entry) => ({
        key: entry.key,
        configured: entry.configured,
        sensitive: entry.sensitive,
      }));

      return { entries };
    }),
};
