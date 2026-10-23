# Body map (#94)

A front and back body diagram on web (`/body-map`) and mobile ("Body map" in
the drawer). It has two separate layers, never blended, and shows only measured
or logged data.

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

## Accessibility

Every web region is a focusable button whose label includes its value.
Enter or Space selects it and shows the region, value, source and scan date
in a live region. On mobile, regions can be tapped on the drawing, and the
regions with values are also listed as buttons for screen readers. Front/back
and layer toggles are radio groups on both platforms.

## Not included

There is no "muscle balance" insight and no asymmetry detection. Changes are
never inferred from weight, and there are no 3D models or photo overlays. Tape-measure
sites from private measurements (#85) could be added as a later layer.
