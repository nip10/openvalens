# Mobile Tone of Voice

## Purpose

This document defines how the mobile app speaks to its user. It covers every user-facing string: labels, empty states, errors, confirmations, notifications, AI assistant prompts, and any future marketing copy. The voice is anchored to the visual system in [`design-system.md`](./design-system.md) and the design direction in [`design-direction.md`](./design-direction.md).

The user is the patient: a single, technically literate adult who built this cockpit for themselves. They do not need persuasion, cheerleading, or medical disclaimers wrapped in anxiety. They need clear, accurate information and a clear next action.

## Voice

**Direct, calm, technically literate.**

The app speaks to an adult who already knows what a fasting window is, who can read a lab panel, and who wants the system to get out of the way. It says what happened, what it means, and what to do next — without panic, without cuteness, and without assuming the user is a patient in a waiting room.

## Voice principles

| Principle                  | Description                                                                                         |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| **Be direct**              | Say the thing in the fewest accurate words. Avoid hedging, throat-clearing, and marketing language. |
| **Be calm**                | Health data can be serious. The copy should not amplify drama. Routine variance is routine.         |
| **Be specific**            | Name the object, the action, and the consequence. “Sync failed” is not enough.                      |
| **Be technically honest**  | Use real units, real codes, and real status names. Do not dumb down precision.                      |
| **Never blame the user**   | Errors describe the state and the recovery path, not the user's mistake.                            |
| **Offer one clear action** | Every state that needs attention should end with or point to a single primary action.               |

### 1. Be direct

Say exactly what the user needs to know. Cut filler.

| Bad                                                                                      | Good                             |
| ---------------------------------------------------------------------------------------- | -------------------------------- |
| "It looks like we were unable to successfully complete your most recent sync attempt."   | "Sync failed. Tap to retry."     |
| "Please take a moment to review the following information about your latest lab result." | "Review your latest lab result." |

### 2. Be calm

Avoid alarmist words for normal situations. Destructive color and urgent words are reserved for actual problems.

| Bad                                              | Good                                                   |
| ------------------------------------------------ | ------------------------------------------------------ |
| "Warning: your LDL is dangerously high!"         | "LDL is above your reference range. Review the trend." |
| "Critical alert — no workouts logged this week!" | "No workouts logged this week. Add one?"               |

### 3. Be specific

Name the service, file, device, or value involved. Generic copy forces the user to guess.

| Bad                     | Good                                                   |
| ----------------------- | ------------------------------------------------------ |
| "Upload failed."        | "Health Connect upload failed: 12 records queued."     |
| "Something went wrong." | "Could not connect to the server. Check your network." |

### 4. Be technically honest

Use correct units, ranges, and status terms. The user understands them.

| Bad                               | Good                                                    |
| --------------------------------- | ------------------------------------------------------- |
| "Your sugar level is a bit off."  | "Glucose is 112 mg/dL, 4 mg/dL above your upper limit." |
| "This might take a little while." | "Syncing 3,400 records. This may take 2–3 minutes."     |

### 5. Never blame the user

Errors describe the problem and the fix. They do not assume user error.

| Bad                                    | Good                                                                 |
| -------------------------------------- | -------------------------------------------------------------------- |
| "You denied permission to read steps." | "Step data is unavailable. Allow Health Connect access in Settings." |
| "Invalid date format entered."         | "Use YYYY-MM-DD."                                                    |

### 6. Offer one clear action

If the copy describes a problem or empty state, pair it with a single primary action.

| Bad                     | Good                                          |
| ----------------------- | --------------------------------------------- |
| "No lab results found." | "No lab results yet. Import a lab PDF."       |
| "Permissions missing."  | "Health Connect needs access. Open Settings." |

## Capitalization and formatting

### Sentence case vs. title case

- **Sentence case** for all UI labels, buttons, headings, empty states, and body copy.
  - "Lab results"
  - "Add supplement"
  - "Sync now"
- **Title case** only for proper nouns: product names, organizations, specific report titles, and named integrations.
  - "Apple Health"
  - "Telegram Bot"
  - "Weekly Review"

Do not use title case for generic screen titles. The screen is "Lab history", not "Lab History".

### Punctuation

- Use periods in full sentences only. Headlines, button labels, and one-line empty states do not end with a period unless they are complete sentences with multiple clauses.
- Use the Oxford comma in lists of three or more items.
- Use en dashes for numeric ranges (`3.5–4.0`). Use em dashes sparingly, only to set off an aside in longer copy.
- Do not use exclamation points except in genuine warnings, and even then prefer a period.

### Emoji

- **Do not use emoji** in status messages, errors, buttons, or labels.
- Emoji may appear in user-generated content or notification previews from external services, but the app itself does not decorate copy with emoji.

### Units and abbreviations

- Always include units when displaying a numeric health value.
- Spell out units on first use in a paragraph if the audience may be non-technical; in labels and tables, abbreviations are fine.
- Use standard medical abbreviations: `mg/dL`, `mmol/L`, `kg`, `lb`, `bpm`, `mmHg`, `%`.
- Do not add a space between the number and `%`: `42%`.
- Add a space between the number and other units: `72.4 kg`, `140 mg/dL`.

## Number formatting

### Units

| Domain         | Default unit  | Toggle |
| -------------- | ------------- | ------ |
| Weight         | kg            | lb     |
| Height         | cm            | ft/in  |
| Glucose        | mg/dL         | mmol/L |
| Cholesterol    | mg/dL         | mmol/L |
| Blood pressure | mmHg          | —      |
| Heart rate     | bpm           | —      |
| Body fat       | %             | —      |
| Sleep          | hours:minutes | —      |

Use the user’s preferred unit everywhere. If a value was imported in a different unit, store the canonical value and display it converted.

### Precision

- Round to the precision meaningful for the biomarker:
  - Weight: 0.1 kg or 0.1 lb.
  - Body fat: 0.1 %.
  - Glucose: whole number mg/dL or 0.1 mmol/L.
  - Sleep: minutes.
- Do not display false precision. A scale that reports 0.1 kg should not show `72.412 kg`.

### Ranges

- Use an en dash without spaces: `3.5–4.0 mg/dL`.
- Use commas for thousands: `12,400 steps`.
- For date ranges, use a compact ISO-like form: `2026-09-25 – 2026-10-01`.

### Relative time

Use concise relative time only when it aids scanning:

- `2 min ago`
- `3 hr ago`
- `Yesterday`
- `Sep 25`
- `2025`

Avoid "a moment ago" or "recently". Be specific.

## Health-data language

### Labs and biomarkers

- Use the biomarker name as it appears in the data: `LDL`, `HDL`, `Triglycerides`, `HbA1c`, `eGFR`.
- Reference ranges are just that: reference ranges. They are not personal targets.
  - Good: "Total cholesterol: 210 mg/dL. Reference range 125–200 mg/dL."
  - Bad: "Your cholesterol is too high."
- Abnormal results are described with neutral language and a path to context.
  - Good: "ALT is above the reference range. Review related markers and the trend."
  - Bad: "Your liver is in danger."

### Ranges and status

Use status terms consistently:

| State                        | Badge text     | Color token                                      |
| ---------------------------- | -------------- | ------------------------------------------------ |
| Within reference range       | "In range"     | `success`                                        |
| Near limit                   | "Near limit"   | `warning`                                        |
| Outside reference range      | "Out of range" | `warning` or `destructive` depending on severity |
| Unknown / no reference range | "No range"     | `mutedForeground`                                |
| Improving trend              | "Improving"    | `info`                                           |
| Worsening trend              | "Worsening"    | `warning`                                        |

Do not label a value "good" or "bad". Label it relative to the user's configured reference range or trend.

### Medication and supplement plans

- Use "plan" for the scheduled regimen, "log" for a recorded intake.
- "Missed" means the window passed without a logged intake. "Skipped" means the user explicitly marked it as skipped. "Late" means logged after the scheduled window.
- Avoid guilt language: "You missed 3 doses" becomes "3 doses missed this week. Review schedule."

### Workouts and wearables

- Use the activity type as recorded: "Run", "Strength", "Swim".
- Distinguish imported data from manually entered data with a small source badge, not with different language.
- Do not anthropomorphize devices. "Watch sync failed", not "Your watch is upset."

## Empty states

Every empty state has three parts:

1. **What is empty** — one line, direct.
2. **Why it matters** — optional one-line context if the user might not understand the section.
3. **Primary action** — a single button or link that lets the user fix the empty state.

### Common patterns

| Scenario           | Headline                        | Context                                               | Action          |
| ------------------ | ------------------------------- | ----------------------------------------------------- | --------------- |
| No data yet        | "No lab results yet"            | "Import a lab PDF or connect a provider."             | "Import lab"    |
| No permission      | "Step data is unavailable"      | "Health Connect needs read access to steps."          | "Open Settings" |
| No network         | "Could not load results"        | "Check your connection and try again."                | "Retry"         |
| No matches         | "No results match your filters" | —                                                     | "Clear filters" |
| No upcoming events | "No events this week"           | —                                                     | "Add event"     |
| No AI review       | "No review generated"           | "Run a weekly review after syncing this week’s data." | "Run review"    |

Empty states do not use the word "Oops" or "Nothing here". They state the fact and offer the fix.

## Error copy

Error strings follow a strict shape:

> **Short cause + short action.**

They never blame the user and never use exclamation points.

| Scenario                | Copy                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| Network failure         | "Could not connect. Check your network and retry."                  |
| Sync failure            | "Health Connect sync failed. 12 records queued. Retry now."         |
| Permission denied       | "Camera access is required to scan a label. Open Settings."         |
| Server error            | "Server error. Try again in a moment."                              |
| Validation error        | "Date must be today or earlier."                                    |
| Ingestion parse failure | "Could not read the uploaded file. Check the format and re-upload." |
| AI unavailable          | "AI review is paused. Enable it in Settings → AI."                  |

### Inline validation

Inline errors appear on field blur or form submit, not on every keystroke. They are one line:

- "Weight must be a number."
- "Start time must be before end time."
- "Select at least one source."

### Full-screen errors

Full-screen errors include:

1. A clear headline.
2. A one-line explanation.
3. A primary action.
4. A secondary action only when it provides a different recovery path (e.g., "Contact support" is not needed; "Copy error ID" may be).

Example:

```text
Could not load weekly review
The server returned a 500 error. Try again in a moment.
[Retry]  [Copy error ID]
```

## AI assistant copy

The AI assistant is consent-gated. Until the user explicitly enables AI in organization settings, the assistant is not accessible and the app does not send PHI to the model.

### When AI is enabled

- **Concise by default.** Answers should fit on one screen without scrolling when possible.
- **No PHI echo.** The assistant does not repeat raw lab values, medication names, or dates back to the user unless necessary for the answer.
- **Uncertainty is explicit.** If the model is unsure, say so.
  - Good: "I'm not confident about this interpretation. Review the source lab, or consult your doctor."
  - Bad: "It looks like everything is fine."
- **No medical advice.** The assistant frames observations as data, not diagnosis.
  - Good: "Your LDL has trended up over the last three panels."
  - Bad: "You should lower your LDL."

### Prompts and placeholders

- Input placeholder: "Ask about your data…"
- Empty state: "Ask a question about your health record."
- Loading state: "Reviewing your record…" (no fake typing, no dramatic pause)
- Error state: "Could not generate a response. Retry or rephrase your question."

### Suggested prompts

Suggested prompts are written in the user’s voice and are specific:

- "Summarize last week’s sleep."
- "What changed in my lipids since July?"
- "List supplements I logged yesterday."

## Notification copy

Notifications are high-leverage. The first ~60 characters are the preview; the body expands only after the user opens it.

### Preview (first line)

- Lead with the action or state, not the app name.
- Keep it under 60 characters.
- No emoji.

| Bad preview                  | Good preview                    |
| ---------------------------- | ------------------------------- |
| "OpenValens reminder"        | "Take 10 mg Atorvastatin"       |
| "You have a new update!"     | "Weekly review is ready"        |
| "Don't forget your workout!" | "Workout scheduled for 6:00 PM" |

### Body

The body adds the minimum necessary context and a tap target:

```text
Weekly review is ready
3 new events, 1 out-of-range marker. Tap to review.
```

```text
Health Connect sync complete
240 records imported from your device.
```

```text
Supplement reminder
Take 2000 IU Vitamin D with food.
```

### Notification categories

| Category         | Preview style            | Body style               |
| ---------------- | ------------------------ | ------------------------ |
| Reminder         | Imperative verb + object | Dose, timing, or context |
| Sync / ingestion | State + source           | Count or duration        |
| Review / summary | Headline result          | One-line breakdown       |
| Error            | State + system           | Recovery action          |

## Buttons and actions

Button labels are verbs or verb phrases, sentence case, and describe the immediate result:

- "Save entry"
- "Import lab"
- "Run sync"
- "Allow access"
- "Skip for now"
- "Delete entry"

Destructive actions repeat the object to reduce accidents:

- "Delete lab result"
- "Remove device"
- "Clear queue"

Cancel actions use plain language:

- "Cancel"
- "Keep editing"
- "Don’t save"

## Settings and preferences

Settings labels describe the current state, not a command:

- "Dark mode" with a toggle (not "Enable dark mode")
- "Compact density" (not "Use compact mode")
- "Health Connect" (not "Connect Health Connect")

Helper text under a setting is one line and explains the consequence:

- "Compact mode shows more rows per screen."
- "AI features require organization consent."

## Date and time copy

Use ISO-like, unambiguous formats:

- Dates in lists: `2026-10-01`
- Dates in prose: "October 1, 2026"
- Times: `08:42` or `20:42` (24-hour preferred; follow system setting if user chooses 12-hour)
- Date-time together: `2026-10-01, 08:42`

Relative time is allowed in activity feeds:

- "2 hr ago"
- "Yesterday"
- "Sep 25"

Avoid "today" without a time unless the context is obvious.

## Accessibility considerations

- Screen readers should read the label and the value as one unit: "Weight, seventy-two point four kilograms" not "Weight label, value seventy-two point four".
- `accessibilityLabel` should not include the visual copy verbatim if the visual copy is already the label. Add context only when the icon or control is ambiguous.
- Error states should be announced with `accessibilityLiveRegion="polite"`.
- Avoid all-caps strings. Screen readers may spell them out.

## Summary

The app’s voice is that of a competent, quiet colleague: direct, calm, and precise. It treats the user as capable, the data as serious, and the interface as a tool. Every string should make the next action obvious and never waste the user’s attention.
