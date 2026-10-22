# Cycle logging (#91)

Optional, member-private cycle logging. It is off by default and turned on
only through its own consent (`cycle.enable({ consent: true, consentVersion: "cycle-v1" })`),
separate from every other setting.

## Privacy

- Rows are keyed by the session's user and active organization; the input
  never names an owner. Every call needs the member's own, non-impersonated
  session. Workspace owners, other members and other tenants get nothing
  (`NOT_FOUND` or an empty list).
- Cycle tables are not read by AI/Coach, clinical exports, Telegram, email or
  analytics. The subject data-rights export includes them (it is the member's
  own copy) and subject erasure deletes them.
- The API writes no audit metadata or logs that carry cycle dates.
- `cycle.turnOffAndErase({ confirm: true })` deletes every period and import
  the member has, in every workspace, and withdraws the consent in one
  transaction.

## Estimates

`cycle.estimates({ today })` counts backward from the next logged period: the
luteal estimate is the 14 days before it, the last 12 being the more likely
part. Cycles shorter than 15 days get no estimate. The current cycle never has
a phase, only "estimated, low confidence". The "hormonal contraception or no
natural cycle" setting turns estimates off. Nothing predicts ovulation, a
fertile window or safe days, and nothing changes calories, macros or targets.

## Import

`cycle.importPeriods({ source, periods })` (`health_connect` or `healthkit`,
up to 500 periods with platform record ids) stores one import run.
Re-importing the same record ids is skipped, a malformed payload writes
nothing, and `cycle.undoImport({ importId })` removes the run and every period
it added while leaving manual rows alone. The mobile app does not call it yet:
reading Health Connect `MenstruationPeriodRecord` needs the
`READ_MENSTRUATION` permission requested only after opt-in, which has to be
checked on a device. HealthKit exposes only `menstrualFlow`, so its periods
must be inferred from flow days before import.

## Screens

Web `/cycle` and native "Cycle" (drawer) cover consent, logging, history,
import undo (web), estimates, the no-natural-cycle setting and turn off and
erase. The weight-trend period band from the original proposal is not built.
