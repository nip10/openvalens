import { useCallback } from "react";
import { Alert } from "react-native";

/** Confirmation for deliberate sign-out actions; local unsynced records will be removed. */
export function useConfirmedSignOut(signOut: () => Promise<void>) {
  return useCallback(
    () =>
      new Promise<void>((resolve) => {
        Alert.alert(
          "Sign out of this phone?",
          "Unsynced data stored on this phone will be removed. Continue only after syncing anything you want to keep.",
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve() },
            {
              text: "Sign out",
              style: "destructive",
              onPress: () => {
                void signOut().then(resolve, resolve);
              },
            },
          ],
        );
      }),
    [signOut],
  );
}
