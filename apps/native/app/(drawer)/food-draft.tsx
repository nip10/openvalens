import { Redirect } from "expo-router";

/** Legacy deep links now enter the diary-owned draft flow. */
export default function FoodDraftRedirect() {
  return <Redirect href={{ pathname: "/log-food", params: { mode: "describe" } }} />;
}
