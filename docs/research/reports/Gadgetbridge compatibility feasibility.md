# Gadgetbridge compatibility feasibility

Checked: 2026-11-02; embedded-integration follow-up 2026-11-03. Research only; no catalog import or device integration implemented.

## Recommendation

The clarified goal is **direct device integration inside OpenValens**, not a catalog or separate companion app. Reusing Gadgetbridge's Android device implementations inside the existing Expo/React Native app is architecturally feasible, but requires extracting an internal Android module and adapting its host dependencies. The catalog remains useful for discovery, not as evidence that integration is implemented. Preserve upstream license and provenance before distributing derived code or data.

## Embedded implementation assessment

OpenValens already has an Android-capable Expo 57 / React Native 0.86 client in [`apps/native/package.json`](../../../apps/native/package.json), including development-build tooling. Native Java/Kotlin code can therefore run inside the same installed app; no separate application or inter-app data bridge is required. The inspected app has no existing Bluetooth device stack.

Gadgetbridge's inspected [Gradle settings](https://github.com/Freeyourgadget/Gadgetbridge/blob/master/settings.gradle) include `:app` and `:GBDaoGenerator`, not a standalone device SDK. Its [application build](https://github.com/Freeyourgadget/Gadgetbridge/blob/master/app/build.gradle) uses the Android application plugin. The follow-up source inspection used the project's GitHub mirror; any implementation must pin and verify the authoritative Codeberg revision before vendoring code.

Its [`DeviceCoordinator`](https://github.com/Freeyourgadget/Gadgetbridge/blob/master/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/devices/DeviceCoordinator.java) and [`DeviceSupport`](https://github.com/Freeyourgadget/Gadgetbridge/blob/master/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/DeviceSupport.java) depend on Android and Gadgetbridge host types. For example, [`HuamiSupport`](https://github.com/Freeyourgadget/Gadgetbridge/blob/master/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/service/devices/huami/HuamiSupport.java) combines family protocol logic with app preferences, persistence, resources and BLE infrastructure. Reuse needs those shared foundations or compatible replacements, not just copied per-device classes.

Recommended implementation direction: an internal Android device-engine module containing upstream-derived protocol families and required Bluetooth infrastructure, with OpenValens-owned pairing/settings UI and a native API consumed by the existing React Native app. This is an engineering proposal, not an extracted or tested module. Preserve family sharing and isolate host adaptations to reduce upstream-update conflicts. Ship health-relevant families incrementally, rather than claiming the entire catalog works at once.

The existing [`mobile-ingest` contract](../../../packages/api/src/contracts/mobile-ingest.ts) only accepts `health_connect` and `apple_health`; direct-device provenance needs an explicit contract extension rather than mislabeling records. Direct device sync also needs durable local buffering/checkpoints and acknowledgement handling: the current health-store design relies on Health Connect/HealthKit retaining unacknowledged data, which cannot simply be assumed for Bluetooth devices. Android-native services/permissions and background behavior need dedicated validation. The Android implementation does not carry over unchanged to iOS.

## What can be extracted

The website repository publishes [`device_support.yml`](https://codeberg.org/Freeyourgadget/website/raw/branch/main/device_support.yml), whose header explicitly describes a machine-readable database of supported gadgets. Its `device_support` mapping contains device IDs, category, vendor, support/pairing/OS/experimental flags, and optional firmware/protocol links. YAML aliases must be resolved. `vendor_mappings` handles vendors whose documentation lives on another vendor page.

The header defines `feature_high`, `feature_most`, `feature_partial`, `feature_poor`, and `feature_unknown` as coarse implementation-status labels. `pair_free` means no vendor app is needed at any stage of pairing with Gadgetbridge. Other pairing flags require consulting their definitions and model documentation; they are not interchangeable with unrestricted, account-free operation.

Human-readable model names and detailed caveats should be joined from the corresponding website pages, not guessed solely from IDs. The YAML documents the page convention `docs/gadgets/<category>/<vendor>.md`, subject to vendor mappings. Flag definitions are maintained in [`extra_config.yml`](https://codeberg.org/Freeyourgadget/website/src/branch/main/extra_config.yml).

The official [Gadgets page](https://gadgetbridge.org/gadgets/) displayed 671 documented gadget models from 92 vendors during this investigation. This includes non-health categories, not just wearables. These are changing documentation counts, not a tested-device count or proof that every working device is documented.

## What cannot safely be inferred

- Exact per-model availability of steps, sleep stages, HRV, workouts, or other health metrics from coarse support flags.
- Compatibility with every firmware, regional variant, or authentication setup.
- OpenValens, Health Connect, or Apple Health compatibility from Gadgetbridge catalog membership.
- A universal protocol or a ready-to-use TypeScript SDK.

The official [new-gadget tutorial](https://gadgetbridge.org/internals/development/new-gadget/) describes `DeviceType` registration, `DeviceCoordinator` identification/capabilities, and `DeviceSupport` communication implementations. The [project overview](https://gadgetbridge.org/internals/development/project-overview/) describes Android communication services and Bluetooth queues. Actual interoperability needs the relevant implementations, authentication, platform plumbing, and hardware testing, rather than just the model list.

## Fit with OpenValens

- [`packages/integrations/wearables/src/adapter.ts`](../../../packages/integrations/wearables/src/adapter.ts) implements a cloud/OAuth contract for Oura, Whoop, Polar, Withings, and Google Health. Gadgetbridge is not an existing provider and should not be forced into this token-oriented interface.
- [`packages/ingestion/src/health-connect.ts`](../../../packages/ingestion/src/health-connect.ts) supplies canonical health metric/event types that could receive locally imported data after a separately verified transport/import path exists.
- [`DATA-LICENSES.md`](../../../DATA-LICENSES.md) establishes source/version/license/provenance practices for imported catalogs and identifies OpenValens code as AGPL-3.0-or-later.
- Earlier [wearable provider research](../notes/Integrations%20and%20tracking%20extras%20evidence/wearable_providers.md) explicitly left Gadgetbridge unchecked; this investigation closes the initial catalog-feasibility gap, not the integration gap.

## Licensing

The separate website repository's [README License section](https://codeberg.org/Freeyourgadget/website/raw/branch/main/README.md) applies AGPLv3 to its documentation and all content unless otherwise specified, linking its own [LICENSE](https://codeberg.org/Freeyourgadget/website/raw/branch/main/LICENSE). No separate exception for `device_support.yml` was identified in the inspected notices. Treat the extracted catalog as AGPL-covered rather than public domain; retain notices, attribution, source availability as applicable, and modification/provenance information. Do not infer an “or later” grant for the website from the app's separate notices.

The application's [`DeviceType.java` header](https://codeberg.org/Freeyourgadget/Gadgetbridge/raw/branch/master/app/src/main/java/nodomain/freeyourgadget/gadgetbridge/model/DeviceType.java) explicitly permits AGPL version 3 or later. The [app repository](https://codeberg.org/Freeyourgadget/Gadgetbridge) also notes differently licensed third-party files. OpenValens already being AGPL makes reuse plausible, but does not waive upstream obligations or establish compatibility for every file. This is not legal advice.

## Suggested next step, not yet implemented

Build a snapshot-based catalog importer that pins the website commit, records artifact hash/license/retrieval date/source URLs, resolves aliases and vendor mappings, validates flags, and filters health-relevant categories. Retain the original upstream support status separately from OpenValens integration and hardware-test status. Missing feature data should remain unknown.

Label entries **“Supported by Gadgetbridge; OpenValens integration unverified”** until an actual data route is implemented and tested. Add any imported dataset to `DATA-LICENSES.md` when implementing distribution; no upstream dataset is bundled by this research note.
