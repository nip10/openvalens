# Nutrition: web and mobile parity (#88)

Parity means a member can do the same core tasks and see the same data and
state on both clients. It does not mean pixel-identical layouts. Navigation
and controls follow each platform.

## Core tasks

| Task                                                            | Web                                                                    | Mobile                                                         |
| --------------------------------------------------------------- | ---------------------------------------------------------------------- | -------------------------------------------------------------- |
| Search the catalog and your own foods, then log one             | `routes/_auth/nutrition.tsx` (AddFood)                                 | `(drawer)/nutrition.tsx` (AddFood)                             |
| Manual quick add (unknown values stay unknown)                  | yes                                                                    | yes                                                            |
| Check portion, source and attribution before saving             | yes                                                                    | yes                                                            |
| Edit amount or slot; delete with undo                           | yes                                                                    | yes (through the offline outbox)                               |
| Favourite a logged food                                         | yes                                                                    | yes (when online; added in this PR)                            |
| Copy a day; mark a day complete                                 | yes                                                                    | yes                                                            |
| Barcode by camera, with typed and manual fallback               | `BarcodeDetector` where the browser supports it, typed code everywhere | camera scanner with a permission prompt, typed code everywhere |
| Offline logging with sync feedback                              | not required; network failures keep saved data and offer retry         | durable outbox with retry and conflict handling                |
| Custom foods (create, edit, archive)                            | `routes/_auth/foods.tsx`                                               | `(drawer)/foods.tsx`                                           |
| Energy estimate, plus accepting or dismissing a weekly proposal | `components/energy-estimate-card.tsx`                                  | `components/energy-estimate-card.tsx`                          |
| Targets and settings, including hide-numbers                    | `routes/_auth/nutrition-targets.tsx`                                   | `(drawer)/nutrition-targets.tsx`                               |

Both clients use the same presenters from `@openvalens/api/presenters/*`, so
labels, unknown values and coverage text are identical.

## Responsive layout

Since #183, controls wrap on narrow screens on both clients. That covers diary
navigation, entry actions, save/cancel groups, barcode controls and custom-food
actions. No action is moved behind a wider breakpoint.

## Hide-numbers mode

Any text that shows food, total, target, estimate, proposal or water values
goes through a presenter that takes `hideNumbers`. Food values go through
`formatNutrientSummaryLine`, which the custom-food lists (fixed in this PR) and
the add-food preview now both use. Until the member's preference is known,
both clients treat the mode as on.

`presenters/hide-numbers.test.ts` runs every one of these presenters with the
mode on. That includes the accessible one-line readings. The test fails if any
digit survives outside a calendar date. When you add a new surface, add its
presenter to that test.

One known difference: in hide-numbers mode, the mobile diary also hides the
logged portion ("150 g"), while web shows it. Portions are not calorie, macro,
weight or target numbers, so both comply.

## Manual checks before a release

These need a person with real devices and assistive technology:

- Use web with the keyboard only and with VoiceOver or NVDA: diary navigation,
  add-food dialog, barcode fallback, editing and undo, proposal confirmation,
  and hide-numbers on and off.
- Use iOS VoiceOver and Android TalkBack on the same flows, plus
  offline-to-online sync announcements.
