import type { I18n } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { AlertButton } from "react-native";

/** A sharing change waiting for the owner to confirm it. */
export type SharingConfirmTarget =
  | { kind: "member"; userId: string; name: string }
  | { kind: "invitation"; id: string; email: string };

/** The arguments for `Alert.alert`: a title, a message and the buttons. */
export type ConfirmAlert = [title: string, message: string, buttons: AlertButton[]];

/**
 * The confirm step before removing a member or revoking an invitation (same
 * copy as the web dialog): it names who is affected, and only the destructive
 * button acts.
 */
export function sharingConfirmAlert(
  i18n: I18n,
  target: SharingConfirmTarget,
  onConfirm: () => void,
): ConfirmAlert {
  const cancel: AlertButton = { text: i18n._(msg`Cancel`), style: "cancel" };
  if (target.kind === "member") {
    const name = target.name;
    return [
      i18n._(msg`Remove ${name}?`),
      i18n._(
        msg`They lose access to this workspace straight away. You can invite them again later.`,
      ),
      [cancel, { text: i18n._(msg`Remove`), style: "destructive", onPress: onConfirm }],
    ];
  }
  const email = target.email;
  return [
    i18n._(msg`Revoke the invitation for ${email}?`),
    i18n._(msg`They can no longer use it to join. You can send a new one later.`),
    [cancel, { text: i18n._(msg`Revoke`), style: "destructive", onPress: onConfirm }],
  ];
}
