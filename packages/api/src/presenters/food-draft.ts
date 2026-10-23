import type { MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { FoodDraftFlag } from "@openvalens/nutrition/food-draft";

import type {
  ParseFoodDraftOutput,
  ParsePhotoFoodDraftOutput,
} from "../contracts/nutrition-food-drafts";

/** Copy for food drafts from a description (Issue #73); shared by web and native. */
export const FOOD_DRAFT_COPY = Object.freeze({
  settingLabel: msg`Make food drafts from a spoken or typed description`,
  settingDescription: msg({
    message:
      "Off by default. Describe a meal and get a draft list to match to foods; nothing is logged until you confirm each item. The app never records audio. Turn it off at any time.",
    comment: "safety",
  }),
  intro: msg`Say or type what you had. You get a draft list of items to match to foods; nothing is logged until you confirm each one.`,
  dictation: msg`To speak, use your keyboard's dictation (microphone) key. This app never records or uploads audio.`,
  aiDisclosure: msg({
    message:
      "The provider processes it under its own terms. Nothing is stored here, and no nutrition values come from the reply.",
    comment: "safety",
  }),
  review: msg`Check each item, fix anything misheard, then find the matching food in your diary and confirm it there. Quantities you did not say stay empty.`,
  status: {
    ready: msg`Draft ready. Nothing has been logged yet.`,
    empty: msg`Say or type at least one food.`,
    unrecognized: msg`No foods were recognised. Try naming each food, for example “two eggs and toast”.`,
    too_long: msg`That description is too long. Keep it under 2,000 characters.`,
    disabled: msg`Turn on food drafts in your nutrition settings first.`,
    ai_unavailable: msg`The AI provider is not set up on this server. Use the on-server draft instead.`,
    consent_required: msg`Confirm sending this text to the provider first.`,
    unparseable: msg`The provider's reply could not be read, so nothing was guessed. Try again or use the on-server draft.`,
  } satisfies Record<ParseFoodDraftOutput["status"], MessageDescriptor>,
});

export const FOOD_DRAFT_FLAG_LABELS: Readonly<Record<FoodDraftFlag, MessageDescriptor>> =
  Object.freeze({
    no_quantity: msg`Quantity not stated`,
    vague_quantity: msg`Quantity unclear`,
    no_unit: msg`Unit not stated`,
    unsure_food: msg`Not sure what this is`,
  });

/** Copy for food drafts from a meal photo (Issue #71); shared by web and native. */
export const PHOTO_DRAFT_COPY = Object.freeze({
  settingLabel: msg`Make food drafts from a meal photo`,
  settingDescription: msg({
    message:
      "Off by default. Each photo is sent to the AI provider only after you confirm it, with location and other photo details removed first. Photos are not stored. Nothing is logged until you confirm each item. Turn it off at any time.",
    comment: "safety",
  }),
  intro: msg`Pick a photo of your meal. You get a draft list of what the provider could see; nothing is logged until you confirm each item.`,
  disclosure: msg({
    message:
      "Location and other photo details are removed before sending. The photo is not stored here, and no nutrition values or portion sizes come from the reply. The provider processes it under its own terms.",
    comment: "safety",
  }),
  review: msg`A photo can be misread. Check each item, fix or remove anything wrong, then find the matching food in your diary and confirm it there.`,
  status: {
    ready: msg`Draft ready. Nothing has been logged yet.`,
    unrecognized: msg`No food could be made out in this photo. Nothing was guessed.`,
    disabled: msg`Turn on photo drafts in your nutrition settings first.`,
    ai_unavailable: msg`Photo drafts need an AI provider, and none is set up on this server.`,
    consent_required: msg`Confirm sending this photo to the provider first.`,
    invalid_photo: msg`Choose a JPEG or PNG photo up to 10 MB. Nothing was sent.`,
    unparseable: msg`The provider's reply could not be read, so nothing was guessed. Try again.`,
    provider_error: msg`The provider could not process this photo. It may not accept images. Nothing was saved.`,
  } satisfies Record<ParsePhotoFoodDraftOutput["status"], MessageDescriptor>,
});
