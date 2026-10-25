# Design: OpenValens

The locked system for the web app (and the colours of the native app). Every screen shares it; change it on purpose, here first.

## System

- Genre: editorial · shape: app screen · theme: Almanac (Hallmark), deal 2/3
- Axes: mid paper / grotesk-sans display / chromatic magenta · posture: restrained · modes: light and dark
- Material: cool slate paper with a pale printed sheet for records and tables, blue-black ink, Hanken Grotesk heads and controls over Newsreader text, figures in IBM Plex Mono, two rule weights, square corners, one deep magenta.

## Tokens

`packages/ui/src/styles/tokens.css` is the source of truth (shared with `apps/native`); `globals.css` adds the spacing, motion and z scale and the base layer. Tailwind names:

| Role   | Utility                                                         | Use                                                                                                 |
| ------ | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Paper  | `bg-background` / `bg-paper`, `bg-paper-2`, `bg-paper-3`        | the page; steps for wells and alternate rows                                                        |
| Sheet  | `bg-card` / `bg-sheet`, or the `.sheet` class                   | the printed page records, tables and forms sit on                                                   |
| Ink    | `text-ink`, `text-ink-2`, `text-ink-3`                          | heads and figures; running text; labels and meta                                                    |
| Rules  | `border-rule` (hairline), `border-rule-2` (firm, 2px)           | rows and divisions; one firm line under a head or a table head                                      |
| Signal | `bg-primary` / `text-signal` / `bg-signal`                      | the primary control, the current place, the one chart series. Under 5% of a screen                  |
| States | `text-success`, `text-warning`, `text-destructive`, `text-info` | in range, near a limit, out of range or failed, informational. Never colour alone: pair with a word |
| Fonts  | `font-display`, `font-body` (default), `font-mono` / `.num`     | heads, controls, nav; text and labels; figures only                                                 |

Never a literal colour (`bg-green-500`, `text-white`, `#fff`, `oklch(...)`) in a component: a token or nothing.

## Type

- Heads: Hanken Grotesk 600, sentence case, tight tracking (the base layer sets h1 to h4). Screen title 34px (`PageHeader`), section head `text-xl`, item title `text-base`/`text-lg`.
- Text: Newsreader 16px, line-height 1.55, measure under 70ch.
- Labels, captions, table heads, meta: Newsreader 500, `text-sm`, `text-ink-3`, sentence case. Never uppercase, never tracked, never mono.
- Figures that compare: `.num` (Plex Mono, tabular), right-aligned in a column (`td.num`/`th.num`). A lone headline figure may run large in mono.

## Surfaces

- No boxed cards and no shadows. Depth is a rule and a paper step. `Card` from `@openvalens/ui` is now the sheet (a 2px ink rule at its head, no border, no radius); never put a Card inside a Card, and prefer `Section` for a group of fields.
- The surface ladder: space, then a hairline, then a paper well (`.well`), then the sheet. Climb different rungs at different seams.
- Tables before cards for anything with rows. Table heads sit over the firm rule; rows part with hairlines; no outer border.
- Radius: 2px on controls (`rounded-sm`), 0 on surfaces.

## Screens

- Every screen is `<Page>` with a `<PageHeader title description actions>` (`apps/web/src/components/page.tsx`), then `Section`s. `Page width="narrow"` for a form or prose, default `wide` for tables and charts.
- Lead with the screen's one object (the record, the table, the chart), not a greeting or a row of stat cards.
- One filled primary control per screen; the rest `outline`, `ghost` or `link`. Destructive actions take the `destructive` (outlined) variant and confirm.
- Every region that loads data draws four states: a `Skeleton` in the shape of what is coming, `EmptyState` (what is empty, why, one action), `ErrorState` (what broke, what to do), and full.
- Stats: `Figure` in a `<dl>` row, parted by hairlines; no icon tiles, no trend arrows nobody measured.

## Charts

- One series argues, in `--chart-1` (the magenta); context series in `--chart-2`/`--chart-4` (ink greys). Never a rainbow.
- 2px lines, hairline gridlines (3 to 5), one y-axis, bars from zero, axis text `text-ink-3` in the body face, values in mono.
- One chart set large beats a page of small ones.

## Controls

- Primary: magenta fill, `signal-ink` label, Hanken Grotesk 500 14px, 36px tall (`h-9`), 2px radius.
- Secondary: ink hairline outline, same height and radius. Inputs: 36px, 1px `input` edge, sheet fill, inset focus ring.
- Focus: a 2px magenta outline, instant. Disabled: 55% opacity, not-allowed cursor, the native attribute.

## Motion

Still. State only: a row tints on hover, a link's underline thickens, colour steps at 220ms. No reveals, no count-ups. Under reduced motion everything ends at once.

## Voice

Declarative, dated, exact: the figure, the unit, the date, the source. No hype adjectives, no exclamation marks, no em dashes.
