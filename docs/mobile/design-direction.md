# Mobile Design Direction

## Purpose

This document defines the visual language, mood, and high-level principles for the React Native / Expo mobile app. It is anchored to the existing web design system documented in [`design-system.md`](./design-system.md), but it goes further: it explains what the app should *feel like*, why it should feel that way, and how to preserve that feeling when translating a dense web interface onto a phone.

It is paired with:

- [`design-system.md`](./design-system.md) — tokens and primitive mapping.
- [`tone-of-voice.md`](./tone-of-voice.md) — copy principles.
- [`foundations.md`](./foundations.md) — navigation, gestures, accessibility, and performance.

## Brand essence

This app is a private, single-user health cockpit for a technically literate patient who is managing their own longitudinal record. It is not a consumer wellness app, a social fitness product, or a clinical EMR. The interface should feel like a serious tool: calm, dense, precise, and trustworthy. Every visual decision should make the user feel that their data is under control, that the system will not surprise them, and that the app respects the weight of what it contains.

## Visual principles

| Principle | Statement | We will | We will not |
|---|---|---|---|
| Density over decoration | The screen exists to show data, not to entertain. | Pack useful information into every view; use cards, lists, and compact tables. | Add hero illustrations, gradients for decoration, or empty whitespace that hides content. |
| Neutral chrome, semantic color | Color carries meaning. | Use neutral grays for structure; reserve color for state, labs, charts, and alerts. | Sprinkle accent colors across unrelated UI elements to “make it pop.” |
| Type as hierarchy | Typography separates levels of importance. | Use Geist Sans for labels and UI, Geist Mono for numbers and IDs, Cormorant Garamond only for large display headings. | Use the serif font for body text, buttons, or small labels. |
| Clarity through restraint | Fewer styles means faster scanning. | Reuse the same spacing, radii, and type treatments everywhere. | Invent new card styles, button shapes, or heading sizes per screen. |
| Touch-first honesty | Mobile interfaces are touched, not pointed at. | Make targets large, gestures discoverable, and states visible on press. | Rely on hover, tiny close buttons, or right-click menus. |
| Quiet motion | Movement should guide, not perform. | Animate layout changes, sheet entrances, and focus transitions with short, linear-ease curves. | Use bouncy springs, parallax, or long cinematic fades. |
| Respect for the data | Health data is sensitive and personal. | Keep the UI sober, avoid sensational colors, and never trivialize abnormal results. | Use celebratory animations, gamified badges, or alarmist reds for routine variance. |

## Mood references

The following references capture the intended tone. They are chosen because they treat dense, high-stakes information with restraint and precision.

| Reference | Why it fits |
|---|---|
| **Apple Health** | Clean information density, platform-native sheets, clear data hierarchy, and a neutral palette with reserved color for trends. It proves a health app can be dense without being clinical. |
| **Linear** | Fast, opinionated, developer-grade tool. The neutral chrome, mono-spaced numbers, and minimal motion are exactly the temperament this cockpit should have. |
| **Radix / shadcn design systems** | The web app already uses this vocabulary. Its deliberate lack of ornament and focus on accessibility and keyboard/touch support is the right baseline for mobile parity. |
| **Monzo / modern fintech dashboards** | Serious money interfaces use color only for status, keep type crisp, and make actions obvious. Labs and financial data share the same need for trust and precision. |

These references are not meant to be copied. They are meant to set a bar: the app should feel as considered as Linear, as trustworthy as Apple Health, and as restrained as Radix.

## Color philosophy

### Neutral structure

The dominant visual material is neutral. Backgrounds are near-white in light mode and near-black in dark mode. Cards, sidebars, inputs, and separators use a tight range of grays. The result is a calm field that lets health data — labs, metrics, events — stand out as content rather than decoration.

### Semantic color

Color is reserved for meaning:

| Color family | Meaning | Example use |
|---|---|---|
| `primary` / `foreground` | Active navigation, primary actions, emphasis | Save button, active tab |
| `destructive` | Errors, destructive actions, out-of-range alerts | Delete, sync failure, critical lab |
| `success` | In-range labs, completed goals, confirmed ingestion | Lab badge, adherence check |
| `warning` | Attention needed, near-limit values, pending sync | Retry badge, borderline result |
| `info` | Neutral informational highlights | Tip, helper link |

Do not use `success` for positive reinforcement unrelated to data (e.g., a success-green brand element). Do not use `destructive` for normal variance. A lab value slightly outside a reference range is not a fire; it is a signal that needs context.

### Chart palette

The `chart-1` through `chart-5` tokens differentiate data series. On mobile, these colors are used exactly as on web:

- Line and bar series use the five chart colors in order.
- A single metric over time uses `primary` unless comparison is needed.
- Overlapping series must use pattern, dashed lines, or labels in addition to color to satisfy color-independence requirements.

In dark mode the chart palette shifts to higher-chroma values so lines remain visible against dark surfaces. This is already defined in the web dark tokens and is preserved verbatim.

## Typography hierarchy rules

### Sans (Geist Variable)

Used for almost everything: labels, body text, button text, navigation, dialog titles, and section headers.

| Size | Use |
|---|---|
| `text-xs` | Timestamps, metadata, badge text, chart axis labels |
| `text-sm` | Default body, input values, button labels, list rows |
| `text-base` | Long-form body, settings descriptions |
| `text-lg` | Dialog titles, bottom-sheet headers, subsection titles |
| `text-xl` | Card titles, page section headings |
| `text-2xl` | Major page headings (sans) |

### Serif (Cormorant Garamond)

Used only for large display headings that need to feel personal or report-like.

| Size | Use |
|---|---|
| `text-3xl` | Report titles, weekly review header, large empty-state headline |
| `text-4xl` | Splash / onboarding title only |

Cormorant Garamond is **never** used for:

- Buttons
- Navigation labels
- Input text
- Small labels or captions
- Lab values or dates
- Toast or notification copy

### Mono (Geist Mono Variable)

Used whenever precision matters or when the value should be scanned like data.

| Use | Example |
|---|---|
| Numbers | `72.4 kg`, `4.2 mmol/L`, `142/90 mmHg` |
| Dates and times | `2026-10-01`, `08:42` |
| IDs and codes | `lab-2026-Q3-1847`, device IDs |
| Durations and ranges | `7h 23m`, `3.5–4.0` |
| Any tabular numeric column | All lab result tables |

Mono is **never** used for prose, headings, or button labels.

## Iconography

### Source

The mobile app uses `@expo/vector-icons` (Ionicons and MaterialIcons). This matches the scaffold in `apps/native/app/(drawer)/_layout.tsx` and `apps/native/app/(drawer)/index.tsx`. Icon names will not map 1:1 with the web’s `lucide-react` set, so choose semantically equivalent icons and document the mapping in the component that uses them.

### Weight and stroke

| Element | Icon size | Stroke weight |
|---|---|---|
| Inline with text | 16 × 16 pt | Default (1.5–2 pt) |
| Button leading icon | 16 × 16 pt | Default |
| Icon-only button | 20 × 20 pt inside 44 pt target | Default |
| List row leading icon | 20 × 20 pt | Default |
| Empty-state illustration | 32–48 pt | Default |
| Tab bar icon | 24 × 24 pt | Default, active filled when available |

### Rules

- Keep icon weights consistent within a screen. Do not mix filled and outlined styles arbitrarily.
- Pair every icon-only control with an `accessibilityLabel`.
- Use the same icon for the same concept across the mobile app. Maintain a small icon-mapping file if a web `lucide` name differs from the `@expo/vector-icons` name.
- Avoid decorative icons that do not add information. If an icon repeats a label, consider omitting it to reduce noise.

## Spacing philosophy

The system is built on a 4 pt grid. Every spacing value is a multiple of 4 pt, which keeps alignment crisp and makes handoff predictable.

### Density defaults

- **Screen edge padding**: 16 pt (`space-4`).
- **Card internal padding**: 16 pt (`space-4`) default, 12 pt (`space-3`) in compact mode.
- **Between cards in a list**: 12 pt (`space-3`).
- **Between related controls in a form**: 16 pt (`space-4`).
- **Between unrelated sections**: 24 pt (`space-6`).
- **Touch target clearance**: 8 pt (`space-2`) minimum between adjacent tappable elements.

### Named spacing scale

| Token | Value | Typical use |
|---|---|---|
| `space-xs` | 4 pt | Tight icon/text pairs, inline badges |
| `space-sm` | 8 pt | Gap inside buttons, small list item padding |
| `space-md` | 16 pt | Card padding, screen gutters, form group gaps |
| `space-lg` | 24 pt | Section gaps, dialog content padding |
| `space-xl` | 32 pt | Large section breaks, empty-state vertical spacing |
| `space-2xl` | 48 pt | Hero empty states, onboarding step spacing |
| `space-3xl` | 64 pt | Full-screen centered illustrations |
| `space-4xl` | 96 pt | Rare; large splash screens only |

Use the numeric scale for precise layouts, the named aliases for component defaults.

## Density modes

The mobile app supports two density modes: **comfortable** (default) and **compact**. The user can switch in Settings → Display. The system default is comfortable.

### Comfortable mode

- Card padding: 16 pt.
- List row height: 56 pt minimum.
- Section gap: 24 pt.
- Body text: 16 pt (`text-base`).
- Touch targets: 48 pt preferred.

Use this for reading-heavy screens: weekly review, lab history, body-composition timeline, AI review.

### Compact mode

- Card padding: 12 pt.
- List row height: 48 pt minimum.
- Section gap: 16 pt.
- Body text: 14 pt (`text-sm`).
- Touch targets: 44 pt minimum.

Use this for data-entry and review screens where the user wants to see more rows at once: medication checklists, supplement schedules, workout logging, ingestion queue.

### Implementation

Density is a single value stored in `AsyncStorage` and exposed through a `DensityProvider`. It drives:

- A `density` prop on list primitives.
- Spacing token overrides for `space-md`, `space-lg`, and list row heights.
- Font size defaults for `text-base` / `text-sm` in long lists.

Density does **not** change:

- Color tokens.
- Border radius.
- Animation timing.
- Accessibility text sizing (Dynamic Type on iOS, font scaling on Android).

If the user enables a system-level larger text size, that overrides compact mode for type; touch targets remain at least 44 pt.

## Visual depth

### Elevation

Mobile surfaces use platform elevation rather than web shadows:

- **Cards**: 1 pt border (`colors.border`) plus subtle platform shadow / elevation 1.
- **Bottom sheets / dialogs**: Backdrop `rgba(0,0,0,0.5)` plus sheet shadow / elevation 8.
- **Buttons**: No shadow in default state; pressed state darkens background.
- **Floating action buttons**: Elevation 4–6.

Do not simulate web `box-shadow` values literally. iOS and Android render shadows differently; the goal is the same perceived depth, not the same CSS string.

### Borders and dividers

- Use 1 pt `hairlineWidth` on high-density screens for dividers where possible; fallback to 1 pt.
- Cards use `colors.border` at 1 pt on all sides in light mode, translucent white at 10 % in dark mode.
- Inputs use `colors.input` border; focus replaces the border with `colors.ring`.

### Texture

The web system is intentionally flat. Mobile keeps that flatness. No gradient meshes, no background patterns, no noise overlays. The only visual texture comes from:

- Subtle platform shadows.
- The natural variation of data density across screens.
- The slight color shift between `background`, `card`, and `muted` surfaces.

## Photography and imagery

The app does not use photography as decoration. Avatar images are the only user-facing images, and they are cropped circular. Empty states use a single icon, not illustrations.

If onboarding needs a visual, use a simple, monochromatic line icon at 48 pt on a `muted` circular background. No characters, no medical clip art, no lifestyle photography.

## Motion philosophy

Motion is functional. It tells the user where something came from, where it went, or that something changed.

| Motion | Allowed? | Notes |
|---|---|---|
| Sheet entrance | Yes | `duration.medium`, `easing.decelerate`, no bounce. |
| Dialog fade | Yes | `duration.normal`, cross-fade backdrop. |
| Button press | Yes | Opacity or background color change, `duration.fast`. |
| List item enter | Yes | Fade + slight translate, `duration.normal`, staggered max 50 ms. |
| Pull-to-refresh spinner | Yes | Native indicator color `primary`. |
| Skeleton pulse | Yes | Opacity oscillation, `duration.slow`, disabled when reduce-motion is on. |
| Parallax, bounce, confetti | No | Not appropriate for a health cockpit. |
| Long shared-element transitions | No | Keep navigation fast and predictable. |

All motion respects `prefers-reduced-motion`. See [`foundations.md`](./foundations.md) for the accessibility fallback rules.

## Responsive and form-factor behavior

The primary target is a portrait phone. Tablets and foldables are secondary.

- **Phone**: Bottom tabs + stack + drawer for long-tail navigation.
- **Tablet / foldable unfolded**: Two-column master-detail where the web sidebar becomes a persistent left rail and the main content occupies the rest.
- **Landscape phone**: Prefer the same layout as portrait; do not add a second column unless the shortest edge is ≥ 600 dp.

Breakpoints mirror the web `useIsMobile` threshold:

| Breakpoint | Width | Layout behavior |
|---|---|---|
| `compact` | < 600 dp | Single column, bottom tabs, drawer |
| `medium` | 600–840 dp | Two-column where appropriate |
| `expanded` | > 840 dp | Persistent sidebar, web-like layout |

## Common mistakes to avoid

| Mistake | Why it breaks the direction | What to do instead |
|---|---|---|
| Adding a splash of brand color to every button | Color loses meaning; the app starts to feel like a consumer product. | Use `primary` for actions and reserve chromatic color for status. |
| Using the serif font for buttons or labels | Cormorant is display-only; at small sizes it is hard to read. | Use Geist Sans for all UI text. |
| Making charts decorative | Chartjunk hides the actual signal. | Remove borders, legends, and background fills that do not encode data. |
| Hiding data behind progressive disclosure when the user asked for it | The cockpit is meant to surface information, not ration it. | Show the data; offer filters, not concealment. |
| Using bounce springs for every transition | Motion becomes a performance, not a cue. | Use short, linear-ease transitions and reserve springs for gesture completion. |
| Designing for portrait phone only | Foldables and tablets are real targets. | Test the two-column and landscape layouts early. |
| Adding gamification | Badges, streaks, and celebrations trivialize health data. | Use neutral status labels and trend indicators. |

## Applying the direction in practice

When starting a new screen, ask:

1. What is the single most important data point? Give it the top-left or top-center position and the largest type appropriate.
2. What actions can the user take? Make the primary action obvious and keep secondary actions in a menu or sheet.
3. Does every color on the screen mean something? If a color is decorative, remove it.
4. Can the screen be understood in grayscale? If not, color is carrying information that also needs shape, label, or position.
5. Is the densest state still scannable? Stress-test with real data, not placeholder content.

These questions keep the app consistent without requiring a rigid template. The direction is a filter, not a checklist.

## Summary

The mobile app should look and feel like the web app transposed onto a phone: the same neutral field, the same type hierarchy, the same component vocabulary, and the same respect for the data. It should not try to be delightful in the consumer-app sense. It should be confident, clear, and fast enough that the user trusts it with their health record.
