import { describe, expect, jest, test } from "bun:test";
import { englishI18n } from "@openvalens/i18n/testing";

import { sharingConfirmAlert } from "./sharing-confirm";

describe("sharingConfirmAlert", () => {
  test("names the member and only the destructive Remove button acts", () => {
    const onConfirm = jest.fn();
    const [title, message, buttons] = sharingConfirmAlert(
      englishI18n,
      { kind: "member", userId: "u-2", name: "Ana Silva" },
      onConfirm,
    );

    expect(title).toBe("Remove Ana Silva?");
    expect(message).toInclude("lose access");
    expect(buttons.map((button) => [button.text, button.style])).toEqual([
      ["Cancel", "cancel"],
      ["Remove", "destructive"],
    ]);
    expect(buttons[0]?.onPress).toBeUndefined();
    buttons[1]?.onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  test("names the invitation's email and confirms with a destructive Revoke", () => {
    const onConfirm = jest.fn();
    const [title, , buttons] = sharingConfirmAlert(
      englishI18n,
      { kind: "invitation", id: "inv-1", email: "rui@example.com" },
      onConfirm,
    );

    expect(title).toBe("Revoke the invitation for rui@example.com?");
    expect(buttons.map((button) => [button.text, button.style])).toEqual([
      ["Cancel", "cancel"],
      ["Revoke", "destructive"],
    ]);
    buttons[1]?.onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
