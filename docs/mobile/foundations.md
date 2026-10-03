# Mobile Foundations

## Purpose

This document defines the cross-cutting UX foundations for the React Native / Expo mobile app: navigation, gestures, forms, data density, loading and error states, accessibility, motion, performance, and offline behavior. It is the engineering companion to [`design-system.md`](./design-system.md), [`design-direction.md`](./design-direction.md), and [`tone-of-voice.md`](./tone-of-voice.md).

The mobile app must achieve UI parity with the existing web app while adding the ingestion responsibilities of the Android Health Connect companion. That means the interface is dense, data-heavy, and operated by a single user who expects precision and speed.

## Navigation pattern

### High-level structure

The mobile app uses **expo-router** file-based routing with a **drawer + tabs + stack** model. This is already wired in the scaffold:

- `apps/native/app/(drawer)/_layout.tsx` — root `Drawer` from `expo-router/drawer`.
- `apps/native/app/(drawer)/(tabs)/_layout.tsx` — `Tabs` from `expo-router`.
- `apps/native/app/(drawer)/index.tsx` — home screen inside the drawer.
- Stack screens push within a tab; modals and sheets overlay the current tab.

This mirrors the web app’s persistent left sidebar: the most-used sections move to the bottom tab bar, and the rest remain reachable through the drawer.

### Web sidebar → mobile mapping

The web sidebar (from `@openvalens/ui/components/sidebar`) is a persistent rail on desktop. On mobile it is split into three surfaces:

| Web sidebar section                       | Mobile home                               | File / notes                                                                                                    |
| ----------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Top-level dashboards / Cockpit            | Primary bottom tab                        | `app/(drawer)/(tabs)/index.tsx`. Label "Review" or "Cockpit".                                                   |
| Timeline / History                        | Primary or secondary bottom tab           | `app/(drawer)/(tabs)/timeline.tsx`. The canonical health timeline is central enough to be a tab.                |
| Labs / Body / Plans / Workouts / Calendar | Bottom tabs or grouped under a "Data" tab | If space is tight, group into `app/(drawer)/(tabs)/data/_layout.tsx` with a sub-nav screen.                     |
| Settings / Account / Integrations         | Drawer                                    | `app/(drawer)/settings.tsx` or nested under `app/(drawer)/settings/`. Lower-frequency items live in the drawer. |
| AI assistant                              | Floating action or top-level tab          | Accessible from the cockpit and via a persistent FAB if it is a frequent action.                                |

### Bottom tab bar

- 3–5 tabs maximum on phones. Tablets may show 5–6.
- Each tab has an icon (`@expo/vector-icons`) and a short label.
- Active tab uses `text-primary`; inactive uses `text-muted-foreground`.
- Tapping the active tab scrolls the current screen to top.
- Long-pressing the active tab offers a small quick-action menu where relevant (e.g., "Add event" on the Calendar tab).

### Drawer

- Triggered by a hamburger icon in the top-left of the header. Already implemented in `apps/native/app/(drawer)/_layout.tsx`.
- Uses the same background, border, and typography tokens as the web sidebar (`bg-sidebar`, `text-sidebar-foreground`, `border-sidebar-border`).
- Shows nested groups with disclosure arrows.
- Includes a theme toggle in the header right area, as in the current scaffold.
- Collapses the same keyboard shortcut logic (`Ctrl/Cmd + B`) on tablets with hardware keyboards.

### Stack behavior

- Each tab owns its own stack. Switching tabs preserves stack state.
- Detail screens push onto the current tab’s stack (e.g., `app/(drawer)/(tabs)/labs/[id].tsx`).
- Full-screen modals (dialogs, sheets) overlay the current tab.
- The top bar (header) shows a back button on screens deeper than the tab root.

### Deep linking

Every detail screen has a stable URL path that matches the web app route where possible:

- `/labs/results/[id]`
- `/timeline?source=healthconnect`
- `/plans/supplements/[id]`

expo-router handles these paths automatically from the file tree. Configure `scheme` and `host` in `app.json` for production deep links.

## Gesture language

The app uses a consistent gesture vocabulary across iOS and Android. All gestures have visible affordances or are paired with equivalent tap actions.

| Gesture                             | Action                                   | Platform notes                                                                                       |
| ----------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Swipe right from left edge**      | Go back                                  | iOS system gesture; Android optional but recommended via screen edge listener.                       |
| **Swipe left on list row**          | Secondary action (e.g., delete, archive) | Reveals a single secondary action. Destructive actions require a second tap or a confirmation sheet. |
| **Swipe right on list row**         | Mark done / quick log                    | Same guardrails as left-swipe.                                                                       |
| **Long press on list row**          | Peek or power menu                       | Shows a context menu with relevant actions. Never the only way to access a feature.                  |
| **Long press on icon-only button**  | Tooltip / label reveal                   | Used sparingly for toolbar icons.                                                                    |
| **Pull down on list / scroll view** | Refresh                                  | Native refresh control on iOS; `RefreshControl` on Android. Color `colors.primary`.                  |
| **Pinch on charts**                 | Zoom / scale                             | Optional. Default is crosshair on tap.                                                               |
| **Tap and drag on chart**           | Crosshair / scrub                        | Shows a tooltip at the touch point.                                                                  |
| **Double-tap on value**             | Edit in place                            | For quick adjustments like weight or dose.                                                           |
| **Drag on sheet handle**            | Expand / dismiss                         | Bottom sheets support drag to dismiss and snap points.                                               |

### Swipe-action confirmation

Destructive swipe actions must not execute on the first swipe. The row expands to show:

1. The destructive action button (e.g., "Delete").
2. The user taps the button to confirm.
3. Optionally, for irreversible actions, a final inline confirmation replaces the row content with "Undo" for 3 seconds.

This prevents accidental deletion of health records.

## Forms

The scaffold uses **@tanstack/react-form** for form state, **zod** for validation, and **heroui-native** for the input surface (`TextField`, `Label`, `Input`, `FieldError`, `Button`, `Spinner`). See `apps/native/components/sign-in.tsx` for the working pattern:

```tsx
import { useForm } from "@tanstack/react-form";
import { Button, FieldError, Input, Label, Spinner, TextField } from "heroui-native";
import z from "zod";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email address"),
});

const form = useForm({
  defaultValues: { email: "" },
  validators: { onSubmit: schema },
  onSubmit: async ({ value }) => {
    /* ... */
  },
});
```

### Input patterns

Mobile forms adapt the web input primitives to touch and on-screen keyboards.

| Field type                      | Keyboard            | Autofill / content type    |
| ------------------------------- | ------------------- | -------------------------- |
| Weight, dose, numeric lab value | `decimal-pad`       | —                          |
| Steps, count                    | `number-pad`        | —                          |
| Date                            | `DateTimePicker`    | —                          |
| Time                            | `DateTimePicker`    | —                          |
| Email                           | `email-address`     | `emailAddress`             |
| Password / PIN                  | `default` secure    | `password` / `newPassword` |
| Text note                       | `default` multiline | —                          |
| Search                          | `search`            | —                          |
| URL                             | `url`               | `URL`                      |
| Telephone                       | `phone-pad`         | `telephoneNumber`          |

### Inline error timing

- Do not show validation errors while the user is typing.
- Show errors on field blur.
- Re-validate and clear errors as soon as the input becomes valid.
- Show all form-level errors on submit attempt.

### Submit-on-enter rules

- Single-line fields: tapping the return key moves focus to the next field.
- Last field in a form: return key submits the form.
- Multiline fields: return inserts a newline; a separate primary button submits.
- Search fields: return executes the search.

### Form layout

- One column by default.
- Fields stack vertically with 16 pt gaps (`space-md`).
- Labels sit above inputs, left-aligned, sentence case.
- Helper text sits below the input in `colors.mutedForeground`.
- Inline errors replace helper text until resolved.

### Date and time pickers

- Use a modal `DateTimePicker` on iOS.
- Use the native picker or a bottom sheet on Android.
- Always show the selected value in the trigger field in ISO-like format: `2026-10-01`.

## Data density

### Charts

The web app uses Recharts SVG charts. Mobile uses a native charting library.

| Chart type   | Mobile adaptation                                                                               |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Line chart   | Native line chart with crosshair on tap. Legend below or inline.                                |
| Bar chart    | Native bar chart. Horizontal scroll if categories exceed screen width.                          |
| Area chart   | Area chart with gradient fill matching the line color at 20 % opacity.                          |
| Pie / donut  | Avoid on phone; use if there are ≤ 5 categories and labels fit.                                 |
| Multi-series | Use the `chart-1` through `chart-5` palette. Add dashed or dotted lines for color independence. |

Chart tooltips become:

- A floating crosshair label on tap.
- A bottom sheet with a data table on long press for dense points.

### Tables

Web tables become native lists first. If a table truly needs columnar layout:

- Use a `FlatList` with a sticky header row.
- Make columns horizontally scrollable when the content is wider than the viewport.
- Numeric columns are right-aligned and use `fonts.mono`.
- Row height is 56 pt in comfortable mode, 48 pt in compact mode.
- Alternating row backgrounds are optional and must not be the only way to track rows.

### Cards and lists

- Use cards for grouped, heterogeneous data (e.g., a weekly review summary).
- Use plain list rows for homogeneous data (e.g., lab result history).
- A screen should not mix cards and list rows arbitrarily; choose one dominant pattern per screen.

### Density switch

The user can toggle comfortable / compact density in Settings → Display. See [`design-direction.md`](./design-direction.md) for the full density specification.

## Loading states

### Skeleton vs. spinner

| Scenario                | Use                              | Notes                                                                      |
| ----------------------- | -------------------------------- | -------------------------------------------------------------------------- |
| Initial screen load     | Skeleton                         | Match the eventual layout: card shapes, list rows, text blocks.            |
| Pull-to-refresh         | Native spinner                   | Color `colors.primary`.                                                    |
| Submitting a form       | Button spinner                   | Disable button, show spinner on the button, keep existing screen content.  |
| Waiting for AI response | Skeleton paragraph + pulsing dot | Do not use a fake typing indicator.                                        |
| Image / avatar          | Placeholder initials or gray box | Fade in image on load.                                                     |
| Background sync         | Subtle inline status             | "Syncing…" text or small spinner in the header, not a full-screen blocker. |

### Skeleton rules

- Use `colors.muted` / `colors.accent` for the base pulse.
- Pulse opacity 0.5 → 1.0 over `duration.slow`.
- Do not animate layout if reduce-motion is enabled; show static gray placeholders instead.
- Skeletons should resemble the real layout closely enough that the transition to content does not cause layout shift.

## Empty states

Empty states follow the pattern in [`tone-of-voice.md`](./tone-of-voice.md): what is empty, optional context, and a primary action.

### The four common scenarios

| Scenario          | Icon                    | Headline                        | Action                              |
| ----------------- | ----------------------- | ------------------------------- | ----------------------------------- |
| **No data**       | Empty inbox or document | "No [items] yet"                | Create / import / add               |
| **No permission** | Lock or shield          | "[Data source] is unavailable"  | Open Settings or request permission |
| **No network**    | Cloud off-line          | "Could not load [items]"        | Retry                               |
| **No result**     | Search                  | "No results match your filters" | Clear filters or adjust query       |

### Example: no lab results

```text
[document-icon]
No lab results yet
Import a lab PDF or connect a provider.
[Import lab]
```

### Example: no permission

```text
[lock-icon]
Step data is unavailable
Health Connect needs read access to steps.
[Open Settings]
```

Empty states never use "Oops", "Nothing here", or emoji.

## Error states

### Connection errors

- Show a non-blocking inline banner when the app detects a network change.
- If the initial load fails, show a full-screen error with retry.
- Queue user actions until the connection returns.

### Sync errors

Sync failures are common in a health-ingestion app. The UI must make them recoverable.

- Show the number of queued records.
- Explain the most recent failure cause in one line.
- Provide "Retry" and "View details" actions.
- Detailed logs are available in Settings → Integrations → [Source].

### Ingestion failures

When a file or payload fails to parse:

- Show the file name and the failure reason.
- Offer "Re-upload" or "Contact support" if the format is unsupported.
- Do not show raw stack traces or PHI in the error message.

### Permission denials

- If permission is required for core functionality, show a persistent inline banner with a link to system settings.
- If permission is optional, degrade gracefully and explain what is missing.
- Never blame the user for denying permission.

### Error recovery paths

| Error        | Primary recovery  | Secondary recovery            |
| ------------ | ----------------- | ----------------------------- |
| Network down | Retry when online | Work offline with cached data |
| Sync failed  | Retry sync        | View queued records           |
| Parse failed | Re-upload file    | Contact support               |
| Server 500   | Retry             | Copy error ID                 |
| Auth expired | Re-authenticate   | —                             |

## Accessibility

### Touch targets

- All interactive elements are at least 44 × 44 pt.
- Primary actions are 48 pt or larger where possible.
- Adjacent targets have at least 8 pt clearance.

### Screen readers

- Every interactive control has an `accessibilityLabel`.
- Icon-only buttons expose their action: "Add supplement", not "Plus icon".
- Form inputs are associated with labels via `accessibilityLabelledBy` or by placing the label inside the input’s `accessibilityLabel`.
- Dynamic content changes are announced with `accessibilityLiveRegion="polite"`.
- Tab bar items expose their label and selected state.

### Dynamic Type and font scaling

- Support iOS Dynamic Type and Android font scaling.
- Layouts must not break at 200 % text size.
- Truncation is acceptable for metadata; labels should wrap.
- Do not disable font scaling globally.

### Reduce motion

- Respect `AccessibilityInfo.isReduceMotionEnabled()` / `useReducedMotion`.
- Disable non-essential animations when reduce motion is on.
- Sheets may still animate but without spring/bounce and with `duration.fast`.
- Skeleton pulses become static placeholders.

### Color independence

- Never rely on color alone for state.
- Out-of-range lab values use an icon, label text, and color.
- Charts use dashed/dotted patterns or labels in addition to color.
- Active tabs use a background pill plus color change, not just color.

### Focus and activation

- Focused inputs show a visible `colors.ring` outline or border.
- Pressed buttons change background color or opacity.
- Selected list rows change background to `colors.accent`.

## Motion

### When to animate

- Layout changes that reveal or hide content.
- Sheet and dialog entrances/exits.
- Button press feedback.
- List item entrances (subtle fade + translate).
- Skeleton pulse.
- Pull-to-refresh spinner.

### When not to animate

- Pure data updates (e.g., a number changing in a dashboard).
- Error state appearance (show immediately).
- Permission denial banners (show immediately).
- Background sync status text (no animation).

### Durations

| Token             | Value  | Use                                            |
| ----------------- | ------ | ---------------------------------------------- |
| `duration.fast`   | 150 ms | Press feedback, opacity changes, small shifts. |
| `duration.normal` | 200 ms | Standard transitions, focus rings.             |
| `duration.medium` | 300 ms | Sheet/dialog entrances.                        |
| `duration.slow`   | 500 ms | Layout shifts, page transitions.               |

### Easings

| Token               | Value              | Use               |
| ------------------- | ------------------ | ----------------- |
| `easing.standard`   | `[0.4, 0, 0.2, 1]` | Most transitions. |
| `easing.decelerate` | `[0, 0, 0.2, 1]`   | Entrances.        |
| `easing.accelerate` | `[0.4, 0, 1, 1]`   | Exits.            |

### Reduce-motion fallback

When reduce motion is enabled:

- Replace opacity/translate entrances with immediate appearance.
- Replace layout animations with cross-fades or direct swaps.
- Keep sheets functional but remove bounce and shorten duration to `duration.fast`.

## Performance budgets

| Metric                       | Target                       | Measurement                                             |
| ---------------------------- | ---------------------------- | ------------------------------------------------------- |
| Time to first content        | < 1.5 s on a mid-tier device | From app launch to first meaningful paint after splash. |
| First contentful interaction | < 2.5 s                      | Time until bottom tabs and first list render.           |
| List scroll FPS              | 60 fps                       | FlatList with 100+ rows, default item height.           |
| Chart render                 | < 100 ms                     | Initial render of a 90-point line chart.                |
| Image load (avatar)          | < 200 ms                     | From URL to visible, cached.                            |
| Sync roundtrip               | < 3 s median                 | Health Connect sync upload + ack on Wi-Fi.              |
| Form submit feedback         | < 100 ms                     | Button disabled + spinner visible.                      |
| Dialog open                  | < 150 ms                     | From tap to fully rendered dialog.                      |
| Bottom sheet open            | < 200 ms                     | From tap to first snap point.                           |

### Bundle budgets

- JavaScript bundle entry: < 3 MB uncompressed on initial download. The scaffold already includes heroui-native, react-native-reanimated, and gesture-handler, so the 2 MB web target is unrealistic; treat 3 MB as the ceiling and 2 MB as the stretch goal.
- All font files: < 1 MB total (use subsetting if necessary).
- No third-party analytics SDKs in the default build.
- Bun 1.4.2 is the runtime; rely on `bun run --bun` for consistent bundling.

### List performance

- Use `FlatList` with `getItemLayout` where row heights are fixed.
- Memoize row components with `React.memo`.
- Avoid inline arrow functions in `renderItem`.
- Use `initialNumToRender` and `windowSize` tuned to the screen length.

### Image performance

- Use `expo-image` with content-aware caching.
- Avatar images are 64–128 pt; request thumbnails at 2× device resolution.
- Lazy-load images below the fold.

## Offline behavior

### Read cache

- The app maintains a local read cache of health records using a local database (e.g., WatermelonDB, SQLite, or Expo SQLite depending on the stack chosen).
- The cockpit, timeline, lab history, and plans are readable offline after first sync.
- Charts render from cached data.

### Write queue

- User-created entries (manual weight, supplement log, workout) are saved locally immediately and queued for sync.
- Each queued write has a unique client-generated ID, timestamp, and sync status.
- The UI shows pending writes with a subtle indicator (e.g., "Saving…" or a small dot).

### Conflict resolution

- Last-write-wins at the field level, using server timestamps as the tiebreaker.
- If the server rejects a write (e.g., validation failure), the local record is marked "needs review" and the user is notified.
- Imported / device-synced data does not overwrite manually entered data without user confirmation.

### Sync status visibility

- A small status line in the cockpit header shows the last successful sync time.
- If the app is offline, the status reads "Offline. Changes will sync when you reconnect."
- Pull-to-refresh triggers a sync attempt.

### Background sync

- On Android, sync jobs are scheduled when the app is backgrounded.
- On iOS, background fetch and push notifications trigger sync when appropriate.
- The Health Connect companion continues to queue records locally if the server is unreachable.

## Security and privacy notes

- The local cache is stored in the app’s sandbox. It is not backed up to iCloud or Google Drive unless encrypted.
- PHI is not included in push notification bodies beyond the minimum needed (e.g., "3 new events" rather than specific lab values).
- Deep links do not embed PHI in query parameters.
- Analytics and crash reporting, if added later, must be opt-in and must redact PHI.

## Summary

The mobile app’s foundations are designed for a dense, single-user health cockpit:

- Bottom tabs + stack + drawer map the web sidebar to touch.
- Gestures are consistent and destructive actions are guarded.
- Forms, charts, and tables adapt to small screens without hiding data.
- Loading and error states tell the user what is happening and what to do.
- Accessibility, motion restraint, and performance budgets keep the app usable under pressure.
- Offline support ensures the user can always read and log, even when sync is delayed.
