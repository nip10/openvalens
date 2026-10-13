import { describe, expect, test } from "bun:test";

import { adminAccessQueryKey, adminConfigurationQueryKey } from "./admin-settings-keys";
import { deriveAdminSettingsState } from "./admin-settings-state";

describe("deriveAdminSettingsState", () => {
  test("returns loading while session is pending", () => {
    expect(
      deriveAdminSettingsState(
        true,
        true,
        { isPending: false, isFetching: false, isError: false, data: { isInstanceAdmin: true } },
        { isPending: false, isFetching: false, isError: false, data: { entries: [] } },
      ),
    ).toBe("loading");
  });

  test("returns denied when user id is missing", () => {
    expect(
      deriveAdminSettingsState(
        false,
        false,
        { isPending: false, isFetching: false, isError: false, data: { isInstanceAdmin: true } },
        { isPending: false, isFetching: false, isError: false, data: { entries: [] } },
      ),
    ).toBe("denied");
  });

  test("returns loading while access is pending or fetching", () => {
    expect(
      deriveAdminSettingsState(
        false,
        true,
        { isPending: true, isFetching: false, isError: false },
        { isPending: false, isFetching: false, isError: false },
      ),
    ).toBe("loading");
    expect(
      deriveAdminSettingsState(
        false,
        true,
        { isPending: false, isFetching: true, isError: false },
        { isPending: false, isFetching: false, isError: false },
      ),
    ).toBe("loading");
  });

  test("returns access-error when access query fails", () => {
    expect(
      deriveAdminSettingsState(
        false,
        true,
        { isPending: false, isFetching: false, isError: true },
        { isPending: false, isFetching: false, isError: false },
      ),
    ).toBe("access-error");
  });

  test("returns denied for ordinary users", () => {
    expect(
      deriveAdminSettingsState(
        false,
        true,
        { isPending: false, isFetching: false, isError: false, data: { isInstanceAdmin: false } },
        { isPending: false, isFetching: false, isError: false },
      ),
    ).toBe("denied");
  });

  test("returns denied when access data is missing", () => {
    expect(
      deriveAdminSettingsState(
        false,
        true,
        { isPending: false, isFetching: false, isError: false, data: undefined },
        { isPending: false, isFetching: false, isError: false },
      ),
    ).toBe("denied");
  });

  test("returns config-loading while config is pending or fetching", () => {
    expect(
      deriveAdminSettingsState(
        false,
        true,
        { isPending: false, isFetching: false, isError: false, data: { isInstanceAdmin: true } },
        { isPending: true, isFetching: false, isError: false },
      ),
    ).toBe("config-loading");
    expect(
      deriveAdminSettingsState(
        false,
        true,
        { isPending: false, isFetching: false, isError: false, data: { isInstanceAdmin: true } },
        { isPending: false, isFetching: true, isError: false, data: { entries: [] } },
      ),
    ).toBe("config-loading");
  });

  test("hides stale cached inventory while config refetches", () => {
    const state = deriveAdminSettingsState(
      false,
      true,
      { isPending: false, isFetching: false, isError: false, data: { isInstanceAdmin: true } },
      {
        isPending: false,
        isFetching: true,
        isError: false,
        data: { entries: [{ key: "STALE_KEY", configured: true, sensitive: false }] },
      },
    );

    expect(state).toBe("config-loading");
  });

  test("returns config-error when config query fails without permission denial", () => {
    expect(
      deriveAdminSettingsState(
        false,
        true,
        { isPending: false, isFetching: false, isError: false, data: { isInstanceAdmin: true } },
        { isPending: false, isFetching: false, isError: true },
        false,
      ),
    ).toBe("config-error");
  });

  test("returns denied when config query fails with permission denial", () => {
    expect(
      deriveAdminSettingsState(
        false,
        true,
        { isPending: false, isFetching: false, isError: false, data: { isInstanceAdmin: true } },
        { isPending: false, isFetching: false, isError: true },
        true,
      ),
    ).toBe("denied");
  });

  test("returns ready when admin access and config data are available", () => {
    expect(
      deriveAdminSettingsState(
        false,
        true,
        { isPending: false, isFetching: false, isError: false, data: { isInstanceAdmin: true } },
        { isPending: false, isFetching: false, isError: false, data: { entries: [] } },
      ),
    ).toBe("ready");
  });

  test("returns loading when config has no data yet", () => {
    expect(
      deriveAdminSettingsState(
        false,
        true,
        { isPending: false, isFetching: false, isError: false, data: { isInstanceAdmin: true } },
        { isPending: false, isFetching: false, isError: false, data: undefined },
      ),
    ).toBe("loading");
  });
});

describe("admin-settings query keys", () => {
  test("access query key is scoped to the signed-in user id", () => {
    expect(adminAccessQueryKey("user-a")).toEqual(["admin-settings", "access", "user-a"]);
    expect(adminAccessQueryKey("user-b")).toEqual(["admin-settings", "access", "user-b"]);
    expect(adminAccessQueryKey("user-a")).not.toEqual(adminAccessQueryKey("user-b"));
  });

  test("configuration query key is scoped to the signed-in user id", () => {
    expect(adminConfigurationQueryKey("user-a")).toEqual([
      "admin-settings",
      "configuration",
      "user-a",
    ]);
    expect(adminConfigurationQueryKey("user-b")).toEqual([
      "admin-settings",
      "configuration",
      "user-b",
    ]);
    expect(adminConfigurationQueryKey("user-a")).not.toEqual(adminConfigurationQueryKey("user-b"));
  });
});
