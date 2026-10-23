# Food drafts from a description (#73)

An optional way to start logging by describing a meal: "two eggs, a slice of
toast and a coffee". The result is a draft list of items to match to foods;
nothing is logged until the member confirms each entry in the meal diary.

## Opt-in

Off by default. The member turns on "Make food drafts from a spoken or typed
description" in nutrition settings (`voiceDraftsEnabled` on
`nutrition_target_settings`) and can turn it off at any time. While off,
`nutritionFoodDrafts.parse` returns `disabled` and processes nothing.

## Audio

The app never records or uploads audio. To speak, the member uses their
keyboard's dictation; only the resulting text reaches the server.

## Modes

- **Local (default):** `parseFoodTranscript` in `@openvalens/nutrition/food-draft`
  splits the text into items and reads stated quantities and units. No third
  party is involved.
- **AI (optional):** only when a provider is configured. The screen names the
  provider and host (`nutritionFoodDrafts.provider`), and the member confirms
  sending this text, and nothing else, for this one draft. The request carries
  that confirmation (`sendToProvider`); if it does not match the configured
  provider and host, nothing is sent (`consent_required`). The organization and
  member AI consent (#123) and the AI rate limit also apply. The provider's reply
  is validated; an unusable reply returns `unparseable` and nothing is guessed.

Neither mode stores the text or the draft, and neither produces nutrient
values. Logs carry the mode, outcome and item count only.

## Review and logging

Each item shows the words it came from, the food text, the stated quantity and
unit, and flags for anything missing or vague (`no_quantity`,
`vague_quantity`, `no_unit`). The member edits or removes items, then "Find and
log this food" opens the meal diary's food search pre-filled with the food
text (`/nutrition?food=…`). There they pick a food with verified provenance or
their own custom food, set the amount and save: the usual separate
confirmation. Discarding the draft discards everything.

## Measured outcome (local parser)

`packages/nutrition/src/food-draft.eval.ts` holds 15 held-out utterances with
hand-edited expected items. Latest run (`bun packages/nutrition/src/food-draft.eval.ts`):
11 of 15 utterances and 20 of 24 items parsed exactly (food text, quantity and
unit). Known misses: dishes whose names contain "and" or "with" ("fish and
chips") are split, quantities stated after the food ("pizza, about three
slices") are not linked to it, and "a couple of" is treated as vague rather
than 2. These are measurements on a small set, not an accuracy claim; the
review step exists because the parser will be wrong.

# Food drafts from a meal photo (#71)

An optional way to start a draft from a photo of a meal. It feeds the same
review and logging steps as above. It is a convenience, not a measurement:
recognition and portion errors vary by meal, and there is no accuracy claim.

## Opt-in and provider

Off by default. The member turns on "Make food drafts from a meal photo" in
nutrition settings (`photoDraftsEnabled` on `nutrition_target_settings`) and
can turn it off at any time. Photo drafts need a configured AI provider; no
provider is assumed, and there is no on-server image model. The photo section
appears only when a provider is configured.

Before each send, the screen names the provider and host and the member
confirms sending this one photo. `nutritionFoodDrafts.parsePhoto` requires that
confirmation (`sendToProvider`) and refuses anything that does not match the
configured provider and host (`consent_required`). The organization and member
AI consent (#123) and the AI rate limit also apply. Every gate is checked
before the photo leaves the server, and nothing is queued for a later send.

Before enabling a provider for photos, an administrator should check its
current processing and retention terms and whether the configured model
accepts images. A provider that rejects the request returns `provider_error`.

## Photo handling and retention

- The server decodes and re-encodes the photo (`sanitizeImage` in
  `@openvalens/body`), which drops EXIF, GPS location and every other metadata
  block. Only the re-encoded bytes are sent to the provider. The integration
  test checks that none of the fixture's metadata canaries, the file name or
  the `Exif` marker reach the provider.
- The photo is not stored: not in object storage, not in the database. Its
  bytes are held in memory for that one provider call. The draft is not stored
  either, so there is nothing to delete afterwards.
- Logs carry the mode (`photo`), outcome and item count only.

## What the draft contains

The provider is asked for the foods it can see, a count only when items are
clearly countable, and a container or piece unit ("slice", "bowl"). It is told
not to estimate weights, volumes, portions or nutrition values. Items it
cannot identify are flagged `unsure_food`. Missing quantities and units are
flagged as for a description. A reply with no items returns `unrecognized`;
an unreadable reply returns `unparseable`; a file that is not a readable JPEG
or PNG returns `invalid_photo` before anything is sent. In every case nothing
is guessed, and no nutrient value is ever taken from the reply.

## Not done yet

- **Mobile:** the setting can be changed in the app, but photo capture is web
  only for now. Sending a picked photo from React Native as a multipart file
  needs testing on a device first.
- **Evaluation:** there is no held-out image set yet. Before recommending a
  provider, run it against representative held-out meal photos with
  hand-edited labels, and report the method and the error distribution by
  case (mixed dishes, drinks, packaged foods, partial views). Do not promise
  an accuracy figure or show a model confidence.
