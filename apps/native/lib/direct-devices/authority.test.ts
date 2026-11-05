import { expect, test } from "bun:test";

import {
  canonicalDirectDeviceScope,
  createAuthorityTicket,
  directDeviceScopeKey,
  invalidateDirectDeviceAuthority,
  isAuthorityTicketCurrent,
} from "./authority";

const scope = { serverUrl: "https://EXAMPLE.test/openvalens/api/", userId: "user-1", organizationId: "org-1" };

test("authority scope canonicalization preserves server base paths and uses tuple JSON", () => {
  const canonical = canonicalDirectDeviceScope(scope);
  expect(canonical.serverUrl).toBe("https://example.test/openvalens/api");
  expect(directDeviceScopeKey(scope)).toBe(JSON.stringify([canonical.serverUrl, "user-1", "org-1"]));
  expect(directDeviceScopeKey({ ...scope, organizationId: "org-2" })).not.toBe(directDeviceScopeKey(scope));
});

test("tickets are immutable and invalidation never revives same-account tickets", () => {
  const ticket = createAuthorityTicket(scope, "login-A");
  expect(Object.isFrozen(ticket)).toBe(true);
  expect(Object.isFrozen(ticket.scope)).toBe(true);
  expect(isAuthorityTicketCurrent(ticket)).toBe(true);
  invalidateDirectDeviceAuthority();
  expect(isAuthorityTicketCurrent(ticket)).toBe(false);
  const laterLogin = createAuthorityTicket(scope, "login-A");
  expect(isAuthorityTicketCurrent(laterLogin)).toBe(true);
  expect(laterLogin.generation).not.toBe(ticket.generation);
});
