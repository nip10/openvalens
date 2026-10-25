# Design: OpenValens

The locked system for the web app (and the colours of the native app). Every screen shares it; change it on purpose, here first. The owner picked this direction ("Bloom") over a clinical one: the app should feel like wellness and feel good, with little text on show. Advanced detail stays available, never in the way.

## System

- Theme: Bloom, a warm wellness look · modes: light and dark (a warm night)
- Warm peach paper with two soft colour glows, soft white cards with generous corners, warm umber ink, Fraunces for headlines and big figures over Figtree for everything else, a terracotta primary, and one soft colour per measure.

## Tokens

`packages/ui/src/styles/tokens.css` is the source of truth (shared with `apps/native`); `globals.css` adds fonts, the paper glow, `.sheet` (the card) and `.well`. Tailwind names:

| Role     | Utility                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paper    | `bg-paper`, `bg-paper-2`, `bg-paper-3` (wells, tracks, hover)                                                                                           |
| Card     | `.sheet` (soft white, 24px corners, warm shadow), or `<Card>` / `Section sheet`                                                                         |
| Ink      | `text-ink` (heads, figures), `text-ink-2` (text), `text-ink-3` (labels, notes)                                                                          |
| Lines    | `border-rule` (hairline), `border-rule-2` (a firmer edge)                                                                                               |
| Primary  | `bg-primary` / `text-signal` (terracotta): the main action, the current page                                                                            |
| Measures | `sleep`, `steps`, `heart`, `weight`, `water`, `food`, each with `-soft`: `text-sleep`, `bg-sleep-soft`, `bg-sleep`, … and `var(--tone-sleep)` in charts |
| States   | `StatusPill` tones `good`, `warn`, `bad`, `neutral` (always a word, never colour alone)                                                                 |

Never a literal colour in a component (`bg-green-500`, `text-white`, `#fff`): a token or nothing. Measure colours are for their measure only; terracotta is for actions and the current place.

Which tone: sleep (sleep, rest, readiness), steps (activity, workouts, effort), heart (heart rate, vitals, medications, cycle), weight (body, weight, body composition, goals), water (water, distance, labs, clinical), food (meals, nutrition, supplements, calories).

## Screens

- Every screen is `<Page>` + `<PageHeader title description? info? actions?>` from `apps/web/src/components/page.tsx`, then content. The description is one short line or nothing.
- Lead with the screen's headline: a row of `StatTile`s (icon, label, big figure, optional `meter` bar, one short `note` or `status` pill), or one hero card. Then one chart, then the rest.
- Less text on sight. Explanations, method notes, sources, caveats and coverage go behind an ⓘ (`InfoTip`, which keeps the text in the DOM for tests and screen readers). Long tables, history and advanced settings go in `<Details summary=…>` (closed). Nothing is deleted.
- Lists of things (supplements, members, goals, workouts, foods) are cards in a grid (`sheet` per item, `ToneIcon` on the left, a chip for the key figure), not bare tables. Tables stay for dense dated history inside `Details`.
- Icons: lucide only, one per section head (`Section icon tone`), per tile, per list item. `ToneIcon` puts it in its soft round tint.
- Dates as people say them: `friendlyDate(i18n, iso)` from `@/utils/friendly` ("Today", "Yesterday", "8 Oct").
- One filled primary per screen; the rest `outline` / `ghost` / `link`. Destructive actions `variant="destructive"`.
- States for each region that loads: `Skeleton` (rounded-3xl for cards), `EmptyState icon title description action`, `ErrorState`, full.

## Charts

- One series in its measure's tone: `color: "var(--tone-<measure>)"` in the ChartConfig. Lines are `AreaChart` + `Area type="monotone"` with a soft vertical gradient fill (the tone at 0.28 opacity fading to 0), `strokeWidth={3}`. Bars `radius={[8,8,8,8]}`, `maxBarSize={18}`.
- `<CartesianGrid vertical={false} stroke="var(--rule)" strokeDasharray="4 6" />`, `tickLine={false} axisLine={false}`, dates via `friendlyDate`, `isAnimationActive={false}`.
- A target is a dashed `ReferenceLine` in `var(--ink-3)`.

## Type

- Headlines and big figures: Fraunces (`font-display`, base h1 to h4). Figures: `num font-display font-medium` (tabular).
- Everything else: Figtree. Labels `text-sm text-ink-3`, sentence case, never uppercase or tracked.

## Controls

- Buttons are pills (`rounded-full`); the primary is terracotta with a soft warm shadow. Inputs and selects 12px corners on the card fill.
- Focus: a 2px terracotta outline, instant. Disabled: 55% opacity, not-allowed cursor, the native attribute.

## Motion

Gentle and still: colour steps on hover, a 2px lift on linked cards, nothing that loops. Under reduced motion everything ends at once.

## Voice

Warm, short and plain: the figure, then one line a friend would say ("Your usual: 7.5k"). No jargon on the surface; no exclamation marks, no em dashes.
