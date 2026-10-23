import type { FoodDraftFlag } from "@openvalens/nutrition/food-draft";

import type { ParseFoodDraftOutput } from "../contracts/nutrition-food-drafts";

/** Copy for food drafts from a description (Issue #73); shared by web and native. */
export const FOOD_DRAFT_COPY = Object.freeze({
  settingLabel: "Make food drafts from a spoken or typed description",
  settingDescription:
    "Off by default. Describe a meal and get a draft list to match to foods; nothing is logged until you confirm each item. The app never records audio. Turn it off at any time.",
  intro:
    "Say or type what you had. You get a draft list of items to match to foods; nothing is logged until you confirm each one.",
  dictation:
    "To speak, use your keyboard's dictation (microphone) key. This app never records or uploads audio.",
  aiDisclosure:
    "The provider processes it under its own terms. Nothing is stored here, and no nutrition values come from the reply.",
  review:
    "Check each item, fix anything misheard, then find the matching food in your diary and confirm it there. Quantities you did not say stay empty.",
  status: {
    ready: "Draft ready. Nothing has been logged yet.",
    empty: "Say or type at least one food.",
    unrecognized:
      "No foods were recognised. Try naming each food, for example “two eggs and toast”.",
    too_long: "That description is too long. Keep it under 2,000 characters.",
    disabled: "Turn on food drafts in your nutrition settings first.",
    ai_unavailable:
      "The AI provider is not set up on this server. Use the on-server draft instead.",
    consent_required: "Confirm sending this text to the provider first.",
    unparseable:
      "The provider's reply could not be read, so nothing was guessed. Try again or use the on-server draft.",
  } satisfies Record<ParseFoodDraftOutput["status"], string>,
});

export const FOOD_DRAFT_FLAG_LABELS: Readonly<Record<FoodDraftFlag, string>> = Object.freeze({
  no_quantity: "Quantity not stated",
  vague_quantity: "Quantity unclear",
  no_unit: "Unit not stated",
});
