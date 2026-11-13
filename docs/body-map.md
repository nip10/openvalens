# Body map (#94)

A front and back body diagram on web (`/body-map`) and mobile ("Body map" in
the drawer). It has separate layers, never blended, and shows only measured
or logged data. The pain layer (#442) is on web; mobile follows.

## Shared presenter

`packages/api/src/presenters/body-map.ts` holds the region ids, labels,
outline shapes (simple self-drawn shapes on a 200 × 400 view box; no vendored
artwork), the DEXA and muscle mappings, and the colour scales. Web draws the
regions with `<svg>` and mobile with `react-native-svg`, both from the same
`compositionLayer` and `trainingLayer` output. A snapshot test pins the colours
and values for a fixture scan.

"Left" and "right" are the member's own: in the front view their left is on
the viewer's right, and in the back view it is on the viewer's left.

## Composition layer

`bodyMap.composition` returns the regional values (`dexa_regional`) for one
scan of the active record, or for two scans in compare mode. A scan from
another record returns `NOT_FOUND`, so a comparison can never mix records. The
scan's source is shown as a kind ("Imported DEXA report"), never as the
uploaded file name.

Each map region lists the DEXA regions it can show, most specific first. For
example, the abdomen uses `android`, then `left_trunk`/`right_trunk`, then
`trunk`; the upper arm uses `left_arm`/`right_arm`, then `arms`. The region
takes the first one the scan actually reported, and its label names that
source ("DEXA left arm"). If none was reported, the region stays grey. Nothing
is interpolated, and nothing is inferred from scale weight. Region spellings
such as `Left Arm`, `arm_left` and `L-arm` are normalized.

- One scan: a five-step blue scale from the lowest to the highest value in
  that scan for the chosen measurement (fat %, bone density, …). The legend
  shows the numeric range of each step.
- Compare: the measured change per region between the two scans, using a
  source that both scans reported. The diverging purple/orange scale avoids
  red/green, and the legend shows the thresholds.

## Training layer

`bodyMap.training` counts logged sets (`workout_set` rows) in the 7 days
ending on the member's local date, grouped by catalog exercise, with that
exercise's catalog muscles (`exercise_muscle`). Exercises with no catalog link
or no muscle data are listed as "not counted".

The presenter maps catalog muscle names (wger English and Latin) to 14 groups.
An exercise counts once per group at its strongest role there: a primary
muscle counts 1 per set and a secondary muscle 0.5. So biceps and brachialis
on one curl don't double-count. Unknown muscle names are listed, not guessed.
The legend steps (4, 8, 12, 16 sets) only group the colours and are not a
recommendation.

## Pain layer (#442)

A record of the pain the member rated, kept separate from composition and
training. It is opt-in per account (`pain_preference`, off until the member
turns it on) and private to the member: entries live in `pain_entry`, keyed by
the organization and the user with a composite foreign key to `member`, like
`private_body_measurement`. Workspace owners, other members and impersonating
admins never see it. Turning it off hides it everywhere (layer, history,
timeline, Coach, MCP) and deletes nothing; subject erasure deletes it, and the
full export includes both tables. It is not in the clinical CSV/PDF export.

Each entry is one region, a 0–10 rating, an optional type (ache, sharp,
burning, throbbing, stiffness, tingling), a time (now by default, never in the
future) and an optional note. Logging several regions at once makes one entry
each.

- Regions: the existing map regions, plus pain-only joint spots with left and
  right (neck, jaw, elbow, wrist and hand, hip, knee, ankle and foot). The
  spots are placed from the artwork in `bodyMapArtwork(figure).painSpots`, share
  one id across the front and back views (the jaw is front only), and are drawn
  only on this layer. `@openvalens/pain` keeps the region ids with their English
  names for the AI tools; a presenter test keeps them equal to the map.
- Colours: the highest rating per region in the last 7 days (30 selectable) on
  the same 5-step ink-blue scale (0–1, 2–3, 4–5, 6–7, 8–10). No alarm red; a
  region with no rating is grey. The text is the number only and reads the same
  for every value.
- History: tapping a region lists its ratings over time with the member's own
  workouts dated that day or the two days before (48 h), as plain facts ("Run,
  45 min, the day before"). No causal wording, no pattern detection.
- A fixed notice is always shown on the pain layer, never triggered by a value:
  "This is a record, not a diagnosis. Talk to a healthcare professional about
  pain that is severe, sudden or not getting better." A copy test bans causal,
  diagnostic and severity wording everywhere else.

API (`pain.*`, records read/write plus the member's own, non-impersonated
session): `preference`, `setPreference({ enabled?, aiVisible? })`,
`log({ regions, rating, type?, loggedAt?, timeZone, note? })`, `delete({ id })`,
`map({ days: 7 | 30, timeZone })` and `history({ region, days?, timeZone })`.

The timeline shows pain entries only to their owner (the member filter from
#441). A separate "Coach and connected AI apps can read my pain log" switch,
off by default, gates the Coach `pain` tool (own session only, no notes) and
the MCP `pain.entries` tool, which also needs the opt-in `pain:read` scope
(notes only with `notes:read`).

## Accessibility

Every web region, and every joint spot on the pain layer, is a focusable
button whose label includes its value.
Enter or Space selects it and shows the region, value, source and scan date
in a live region. On mobile, regions can be tapped on the drawing, and the
regions with values are also listed as buttons for screen readers. Front/back
and layer toggles are radio groups on both platforms.

## Not included

There is no "muscle balance" insight and no asymmetry detection. Changes are
never inferred from weight, and there are no 3D models or photo overlays. Tape-measure
sites from private measurements (#85) could be added as a later layer.
