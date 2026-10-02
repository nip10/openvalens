# Open-source license choice for openhealth (self-hostable personal health app)

Scope: AGPLv3 vs GPLv3 vs MPL-2.0 vs Apache-2.0 vs MIT vs source-available (BSL/FSL/Elastic) for a TypeScript monorepo (Hono/oRPC server, React web, Expo RN mobile, Postgres) that may later have a maintainer-run hosted offering. Research current as of 2026-10-02. **Not legal advice.** Items marked "COUNSEL" should be checked with a lawyer before relying on them.

Method note: GitHub license metadata was pulled live via `gh api repos/<owner>/<repo>` on 2026-10-02 (SPDX id, archived flag, last push). gnu.org returned HTTP 429 during this session, so GNU FAQ/license-list claims below are sourced from the license text itself (via opensource.org) or from the counterpart license steward (Apache, Mozilla, Creative Commons) instead.

## 1. What do comparable self-hosted projects use, and why?

### Takeaway

The self-hosted consumer/prosumer space splits roughly into AGPL (Immich, Nextcloud, Plausible, Mealie, wger, Signal) and MIT/Apache (Umami, Actual Budget, Home Assistant, PostHog core, Cal.diy). Commercial operators who want a protected hosted/enterprise tier use either AGPL + a proprietary/source-available enterprise directory (Bitwarden, PostHog `ee/`) or a fully source-available license (Sentry FSL). The most notable recent shifts are Immich MIT->AGPL (2024, explicitly no CLA) and Cal.com going closed-source in April 2026 with its open edition relaunched as MIT "Cal.diy".

### Cited Findings

Live license metadata (GitHub API, 2026-10-02):

| Project                  | Repo                                           | SPDX (GitHub detection)                         | Notes                                     |
| ------------------------ | ---------------------------------------------- | ----------------------------------------------- | ----------------------------------------- |
| Immich                   | immich-app/immich                              | AGPL-3.0                                        | active                                    |
| Nextcloud server         | nextcloud/server                               | AGPL-3.0                                        | active                                    |
| Nextcloud iOS / Android  | nextcloud/ios, nextcloud/android               | GPL-3.0 / GPL-2.0                               | shipped in App Store / Play               |
| Home Assistant           | home-assistant/core                            | Apache-2.0                                      | active                                    |
| Plausible                | plausible/analytics                            | AGPL-3.0                                        | active                                    |
| Umami                    | umami-software/umami                           | MIT                                             | active                                    |
| Actual Budget            | actualbudget/actual                            | MIT                                             | active                                    |
| Mealie                   | mealie-recipes/mealie                          | AGPL-3.0                                        | active                                    |
| wger (fitness/nutrition) | wger-project/wger                              | AGPL-3.0                                        | active                                    |
| Fasten Health            | fastenhealth/fasten-onprem                     | GPL-3.0                                         | **archived = true**, last push 2026-02-13 |
| Cal.com open edition     | calcom/cal.com -> redirects to calcom/cal.diy  | MIT                                             | renamed                                   |
| Sentry                   | getsentry/sentry                               | NOASSERTION (FSL-1.1-Apache-2.0)                | source-available                          |
| PostHog                  | PostHog/posthog                                | NOASSERTION (MIT + `ee/` license)               | open core                                 |
| Bitwarden server         | bitwarden/server                               | NOASSERTION (AGPL-3.0 + Bitwarden License v1.0) | open core                                 |
| Bitwarden clients        | bitwarden/clients                              | NOASSERTION (GPL-3.0 + Bitwarden License v1.0)  | open core                                 |
| Bitwarden Android / iOS  | bitwarden/android, bitwarden/ios               | GPL-3.0                                         | shipped in stores                         |
| Signal iOS / Android     | signalapp/Signal-iOS, signalapp/Signal-Android | **AGPL-3.0** (not GPLv3 as sometimes stated)    | shipped in stores                         |
| Open Food Facts server   | openfoodfacts/openfoodfacts-server             | AGPL-3.0                                        | data under ODbL (see Q4)                  |

Source for all rows: GitHub REST API `GET /repos/{owner}/{repo}` — e.g. [immich](https://github.com/immich-app/immich), [nextcloud/server](https://github.com/nextcloud/server), [home-assistant/core](https://github.com/home-assistant/core), [plausible](https://github.com/plausible/analytics), [umami](https://github.com/umami-software/umami), [actual](https://github.com/actualbudget/actual), [mealie](https://github.com/mealie-recipes/mealie), [wger](https://github.com/wger-project/wger), [fasten-onprem](https://github.com/fastenhealth/fasten-onprem), [cal.diy](https://github.com/calcom/cal.diy), [sentry](https://github.com/getsentry/sentry), [posthog](https://github.com/PostHog/posthog), [bitwarden/server](https://github.com/bitwarden/server), [bitwarden/clients](https://github.com/bitwarden/clients), [Signal-iOS](https://github.com/signalapp/Signal-iOS), [Signal-Android](https://github.com/signalapp/Signal-Android), [nextcloud/ios](https://github.com/nextcloud/ios).

Immich:

- Immich switched MIT -> AGPLv3 on 2024-02-11; stated reason: "we want to keep anyone from using the Immich source code without making their changes public or contributing back to the project." — [Immich discussion #7023](https://github.com/immich-app/immich/discussions/7023)
- On CLA: maintainers said concerns about a pricing "bait-and-switch" motivated AGPL, and "requiring a CLA would bring it back, defeating the point. As such we will not be requiring a CLA." — [Immich discussion #7023](https://github.com/immich-app/immich/discussions/7023)
- After joining FUTO: "Immich will continue to be licensed under AGPL without a CLA." — [Immich joins FUTO](https://immich.app/blog/immich-joins-futo)
- Immich sells optional (honor-system) "supporter" licenses while remaining AGPL — [Immich discussion #11186](https://github.com/immich-app/immich/discussions/11186)

Plausible:

- Switched MIT -> AGPL on 2020-10-12 because corporations took the code, closed it, and sold competing products, and large companies wanted to resell Plausible Self-Hosted without contributing back. Notes Google's internal policy that AGPL "MUST NOT be used at Google", which Plausible viewed as a feature. No CLA mentioned in the post. — [Plausible blog: open source licenses](https://plausible.io/blog/open-source-licenses)

Nextcloud:

- Nextcloud forked from ownCloud (June 2016) with most top contributors; a key differentiator was dropping ownCloud's CLA. Nextcloud chose not to own the code, so no CLA; a CLA is what enables dual licensing because it requires full ownership/rights from every contributor. Developer dissatisfaction with the CLA is widely cited as a factor in the defections. — [FOSS Force](https://fossforce.com/2016/06/owncloud-forked-nextcloud/); [FOSDEM 2018 interview with Frank Karlitschek](https://archive.fosdem.org/2018/interviews/frank-karlitschek/); [Nextcloud press release](https://nextcloud.com/fr/blog/press_releases/pr20160602/)

Cal.com (major 2026 change):

- 2026-04-14: Cal.com moved its production codebase to private repositories, citing AI-driven vulnerability scanning of public code ("like giving attackers the blueprints to the vault"); the open, self-hostable edition continues as **Cal.diy under MIT**. — [Cal.com blog: going closed source](https://cal.com/blog/cal-com-goes-closed-source-why); [Cal.com blog: technical changes behind Cal.diy](https://cal.com/blog/cal-diy-open-source-to-closed-source)
- Secondary reporting states Cal.diy's license changed from AGPL-3.0 to MIT and commercial/enterprise features were removed. — [AlternativeTo](https://alternativeto.net/news/2026/4/cal-com-is-going-closed-source-with-a-major-shift-in-its-license-strategy/). Note: Cal.com's own post (as fetched) does not mention the prior AGPL license; GitHub API confirms current repo `calcom/cal.diy` is MIT.
- Community framed it as "AI security or business move?" — [byteiota](https://byteiota.com/cal-com-goes-closed-source-ai-security-or-business-move/) (opinion piece)

Sentry (FSL):

- Sentry relicensed Sentry and Codecov to the Functional Source License in Nov 2023: source-available for non-competing use from day one, converting to Apache-2.0 or MIT after two years; created because BSL "Additional Use Grant" meant different things at MariaDB/Redis/HashiCorp. — [TechCrunch 2023-11-20](https://techcrunch.com/2023/11/20/with-functional-source-license-sentry-wants-to-grant-developers-freedom-without-harmful-free-riding/); [Sentry blog: introducing FSL](https://blog.sentry.io/introducing-the-functional-source-license-freedom-without-free-riding); [Heather Meeker](https://heathermeeker.com/2023/11/18/sentry-launches-functional-source-license-a-new-twist-on-delayed-open-source-release/)
- Sentry's LICENSE.md is "FSL-1.1-Apache-2.0"; Permitted Purpose = anything other than a Competing Use, i.e. "making the Software available to others in a commercial product or service that substitutes for the Software" (or for another Sentry product). — [getsentry/sentry LICENSE.md](https://github.com/getsentry/sentry/blob/master/LICENSE.md)
- Sentry later rebranded the model "Fair Source". — [Sentry is now Fair Source](https://blog.sentry.io/sentry-is-now-fair-source/)

PostHog:

- LICENSE: everything outside `ee/` is MIT Expat; `ee/` is under `ee/LICENSE`; third-party parts under their own licenses. — [PostHog LICENSE](https://github.com/PostHog/posthog/blob/master/LICENSE)

Bitwarden:

- Server: default AGPL-3.0; code under `/bitwarden_license` is under the source-available Bitwarden License v1.0; no trademark grant. Clients: same split with GPL-3.0 as default. — [bitwarden/server LICENSE.txt](https://github.com/bitwarden/server/blob/main/LICENSE.txt); [bitwarden/clients LICENSE.txt](https://github.com/bitwarden/clients/blob/main/LICENSE.txt)
- Oct 2024 controversy: a desktop client dependency (`sdk-internal`) carried a clause restricting use to Bitwarden-compatible apps, making the GPL client effectively unbuildable without non-free code; CTO Kyle Spearrin called it a "packaging bug"; Bitwarden reorganized so the referenced SDK is GPL-licensed and renamed the old SDK repo `sdk-secrets`. — [Phoronix](https://www.phoronix.com/news/Bitwarden-Code-Cleared-Up); [The Register 2024-11-04](https://www.theregister.com/2024/11/04/bitwarden_gpls_password_manager/); [AlternativeTo](https://alternativeto.net/news/2024/10/bitwarden-cto-clarifies-sdk-license-concerns-reaffirming-open-source-commitment)

Elastic (source-available -> back to AGPL option):

- Elastic moved Elasticsearch/Kibana from Apache-2.0 to SSPL + Elastic License in 2021 (aimed at AWS), then in Sept 2024 added AGPLv3 as an option. Shay Banon: "We're delighted to reintroduce an OSI-approved open source license". — [Elastic: Open source, and here's why](https://www.elastic.co/about/open-source); [DevClass 2024-09-02](https://www.devclass.com/databases/2024/09/02/elasticsearch-will-be-open-source-again-as-cto-declares-changed-landscape/1618331)

Fasten Health (closest domain comparable — personal health records):

- fasten-onprem is GPL-3.0 and the GitHub repo is archived (API `archived: true`, last push 2026-02-13). README states the self-hosted PHR is "maintained by the community and is not the same product as Fasten Connect" (the commercial offering) and lacks direct EHR integrations. — [fasten-onprem README](https://github.com/fastenhealth/fasten-onprem); [GitHub API](https://api.github.com/repos/fastenhealth/fasten-onprem)

### Inferences

- For a maintainer who wants to (a) maximize community trust and (b) prevent a third party from running a closed, modified hosted competitor, AGPLv3 without a CLA is the dominant pattern in this exact niche (Immich, Nextcloud, Plausible, Mealie, wger). It deliberately gives up the maintainer's ability to relicense or sell proprietary licenses unilaterally.
- Permissive (MIT/Apache) projects with commercial hosted offerings (Umami, PostHog, Home Assistant/Nabu Casa) rely on brand, convenience, and hosted-only features rather than license protection.
- Cal.com's 2026 move shows that projects with commercial pressure can still retreat to closed source; it relaunched the open edition under MIT, which suggests a CLA or full ownership was in place. Fasten's archival shows the risk that a commercial health company's self-hosted edition can be abandoned regardless of license.
- Bitwarden shows the reputational risk of open-core boundaries leaking into the build of the "open" product.

### Gaps

- Primary-source rationale for Home Assistant (Apache-2.0), Umami (MIT), Actual Budget (MIT), and Mealie (AGPL) was not retrieved in this session; only current SPDX ids are verified.
- Whether Cal.com used a CLA (which enabled the MIT relaunch) was not verified from a primary source.
- PostHog `ee/LICENSE` terms not fetched.
- Fasten's archival rationale not found in a primary announcement (an API-catalog site claims self-hosted is "no longer under active development"; not relied on).

## 2. AGPL network clause, the maintainer's hosted offering, and CLA vs DCO

### Takeaway

AGPL §13 obligates source offering only when someone **modifies** the program and lets users interact with it over a network; an unmodified self-host carries no extra AGPL duty, and the copyright holder is not bound by its own license. But once outside contributions are merged under AGPL without a CLA, the maintainer's hosted service is itself running others' AGPL code, so modifications to it must be offered too, and the maintainer cannot later dual-license or relicense without contributor consent. A CLA (or copyright assignment) preserves that option but is a known community-trust cost (ownCloud->Nextcloud; Immich explicitly refused one).

### Cited Findings

- AGPLv3 §13: "if you modify the Program, your modified version must prominently offer all users interacting with it remotely through a computer network (if your version supports such interaction) an opportunity to receive the Corresponding Source of your version ... from a network server at no charge". — [AGPLv3 text via OSI](https://opensource.org/license/agpl-v3)
- AGPLv3 §13 also expressly permits linking/combining AGPL work with GPLv3 work into a single combined work (each part keeps its own license; the network-interaction requirement applies to the combination). — [AGPLv3 text via OSI](https://opensource.org/license/agpl-v3)
- A CLA is what makes dual licensing possible because dual licensing requires the company to hold rights to all the code; Nextcloud deliberately chose not to own the code and dropped the CLA. — [FOSS Force](https://fossforce.com/2016/06/owncloud-forked-nextcloud/); [FOSDEM 2018 interview](https://archive.fosdem.org/2018/interviews/frank-karlitschek/)
- Immich: AGPL was adopted to remove "bait-and-switch" risk; a CLA "would bring it back, defeating the point". — [Immich discussion #7023](https://github.com/immich-app/immich/discussions/7023)
- Plausible notes AGPL software can still be commercialized by selling commercial licenses that remove copyleft obligations (which requires holding the rights). — [Plausible blog](https://plausible.io/blog/open-source-licenses)
- Elastic's history (Apache -> SSPL/ELv2 -> +AGPL) was only possible because the company controlled the copyright. — [Elastic](https://www.elastic.co/about/open-source)

### Inferences

- Self-hosters: running unmodified openhealth (even for family members over the internet) triggers no source-offer duty under AGPL; running a modified fork exposed to users does. For a health app this is a low burden for individuals, and it deters a closed SaaS fork.
- Maintainer's hosted offering: if openhealth Inc./the maintainer holds all copyright (sole author or CLA), the maintainer can run proprietary hosted-only modules. Without a CLA, any hosted-only proprietary features must be cleanly separated (separate program, not a modification of the AGPL work) — this boundary is a COUNSEL item.
- Middle-ground options seen in practice: (a) DCO (Developer Certificate of Origin, sign-off per commit) — certifies provenance but grants no relicensing rights; (b) a narrow CLA/"license-back" granting the maintainer a relicensing right; (c) no CLA plus a public pledge (Immich). The trade-off is optionality vs contributor trust.
- Choosing AGPL now and keeping DCO preserves the ability to move to a _more_ permissive license only with contributor consent; moving from MIT to AGPL later (as Immich and Plausible did) is easy because permissive code can be relicensed into copyleft.

### Gaps

- Primary DCO text (developercertificate.org) and specific contributor-survey data on CLA vs DCO sentiment were not fetched this session.
- Whether a maintainer's own hosted instance that incorporates third-party AGPL contributions must publish its modifications (it should, as a licensee of contributors' code) — reasoning is straightforward but should be confirmed with COUNSEL.
- GNU FAQ entries on "selling exceptions" were not retrievable (gnu.org 429).

## 3. AGPL/GPL and app stores (Apple, Google Play)

### Takeaway

Apple's App Store has a documented history of conflict with GPL (GNU Go 2010, VLC 2011), rooted in the standard Licensed Application EULA's no-redistribution/device-use terms. Today, AGPL/GPL apps ship on iOS in practice (Signal is AGPL-3.0; Bitwarden iOS and Nextcloud iOS are GPL-3.0), typically because the copyright holder distributes its own code (and so is not bound by its own license) and/or ships a custom EULA. Contributors' code is the risk: a single contributor holding copyright could, in principle, object as Rémi Denis-Courmont did for VLC. Google Play has no comparable history.

### Cited Findings

- 2010: FSF found a GNU Go port on the App Store and argued Apple's iTunes Store Terms of Service impose restrictions forbidden by GPLv2 §6 ("You may not impose any further restrictions..."); Apple removed the app rather than change its terms. — [FSF: GPL Enforcement in Apple's App Store](https://www.fsf.org/news/2010-05-app-store-compliance); [LWN](https://lwn.net/Articles/391423/)
- 2011: VLC for iOS (GPLv2, by Applidium) was removed in January 2011 after VLC developer Rémi Denis-Courmont complained to Apple; in Oct 2011 VLC began relicensing its engine (libVLC) from GPL-2.0-or-later to LGPL-2.1-or-later, partly to achieve App Store compatibility. — [Wikipedia: VLC media player](https://en.wikipedia.org/wiki/VLC_media_player); [Cult of Mac](https://www.cultofmac.com/news/vlc-app-pulled-from-the-app-store-in-response-to-nokia-employees-gpl-crusade)
- Apple's standard EULA grants "a nontransferable license to use the Licensed Application on any Apple-branded products that you own or control" and "You may not transfer, redistribute or sublicense the Licensed Application"; it carves out activity "permitted by the licensing terms governing use of any open-sourced components included with the Licensed Application". — [Apple Licensed Application EULA](https://www.apple.com/legal/internet-services/itunes/dev/stdeula/)
- Developers can supply a custom EULA in App Store Connect; the standard EULA applies only if none is provided. — [App Store Connect Help: custom license agreement](https://developer.apple.com/help/app-store-connect/manage-app-information/provide-a-custom-license-agreement)
- Practitioner claim that a custom EULA can supersede the conflicting part of Apple's EULA (cited example: iSH ships a GPL x86 Linux userland). — [Hacker News comment](https://news.ycombinator.com/item?id=32751155) (non-authoritative; COUNSEL)
- Current store-shipped copyleft clients: Signal iOS/Android AGPL-3.0; Bitwarden iOS/Android GPL-3.0; Nextcloud iOS GPL-3.0, Android GPL-2.0 (GitHub API, 2026-10-02) — [Signal-iOS](https://github.com/signalapp/Signal-iOS), [bitwarden/ios](https://github.com/bitwarden/ios), [nextcloud/ios](https://github.com/nextcloud/ios)

### Inferences

- If the mobile (Expo) app is AGPL/GPL, the safest store posture is: maintainer holds copyright or has an inbound grant (CLA or a narrow "app store distribution" permission/additional permission under GPLv3 §7) covering contributions; ship a custom EULA that defers to the open-source license; keep the source and build instructions public. COUNSEL should confirm.
- An alternative used by some projects is to license the mobile client under a weaker license (MPL-2.0, Apache-2.0, or MIT) while the server is AGPL; the mobile app is mostly a client to the server's API, so this costs little protection.
- Expo/React Native and most RN libraries are MIT; bundling them into a GPL/AGPL app is fine (permissive -> copyleft direction).
- Google Play: no known GPL-vs-terms enforcement incident found; F-Droid is the copyleft-friendly Android channel (not verified this session).

### Gaps

- Google Play Developer Distribution Agreement text was not fetched; no primary-source statement on GPL compatibility found.
- How Signal/Immich specifically handle App Store terms (custom EULA? copyright ownership?) was not confirmed from primary sources. Immich mobile license metadata was not separately checked (the monorepo is AGPL-3.0).
- No primary source found for a post-2011 Apple removal over GPL.

## 4. Dependency and dataset license compatibility; audit tooling

### Takeaway

MIT/ISC/BSD/Apache-2.0 deps flow into any of the candidate licenses (Apache-2.0 into GPLv3/AGPLv3 only, not GPLv2). MPL-2.0 deps are fine (file-level copyleft; combinable with GPL by default). GPL/AGPL deps would force a copyleft outcome on a permissively licensed openhealth. Data is a separate track: Open Food Facts is ODbL (database) + DbCL (contents) + CC BY-SA (images) with attribution and share-alike on adapted databases; wger exercise/ingredient data is CC-BY-SA; CC BY-NC data is incompatible with any OSI license and with commercial hosting. Use REUSE/SPDX for the repo's own licensing and an SBOM/license scanner for deps.

### Cited Findings

Code compatibility:

- Apache-2.0 is compatible with GPLv3 one-way ("Apache 2 software can therefore be included in GPLv3 projects ... However, GPLv3 software cannot be included in Apache projects"); FSF has never considered Apache-2.0 compatible with GPLv2 (patent termination/indemnification). — [Apache: GPL compatibility](https://www.apache.org/licenses/GPL-compatibility.html)
- MPL-2.0 is file-level copyleft ("The copyleft applies to any files containing MPLed code"); MPL code can be combined into a Larger Work with GPL/AGPL unless the author marked it "Incompatible With Secondary Licenses" (an active opt-in, not default). — [Mozilla MPL 2.0 FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- AGPLv3 and GPLv3 code may be combined (§13). — [AGPLv3 via OSI](https://opensource.org/license/agpl-v3)

Datasets:

- Open Food Facts: database under ODbL, individual contents under DbCL, product images under CC BY-SA; reusers must "mention the licence and attribute the authorship to Open Food Facts with a link"; adaptations carry share-alike; third-party trademark/image rights may still apply. — [Open Food Facts terms of use](https://world.openfoodfacts.org/terms-of-use)
- ODbL: public use of an adapted database, or works produced from an adapted database, requires offering the adapted database under ODbL; produced works require attribution notice (e.g. "Contains data from Open Food Facts, available under the Open Database License"). — [Open Food Facts data page](https://world.openfoodfacts.org/data); [OFF wiki: ODBL License](https://wiki.openfoodfacts.org/ODBL_License)
- wger: code AGPL-3.0-or-later; initial exercise and ingredient data licensed CC-BY-SA 3.0 (some images from Wikipedia), per-entry Creative Commons licenses with license/author fields. — [wger README](https://github.com/wger-project/wger); [wger docs](https://wger.readthedocs.io/)
- Alternative exercise datasets on GitHub: yuhonas/free-exercise-db (Unlicense), exercemus/exercises (MIT; curated partly from wger.de — so upstream CC-BY-SA provenance should be checked) — [free-exercise-db](https://github.com/yuhonas/free-exercise-db); [exercemus/exercises](https://github.com/exercemus/exercises)
- CC BY-SA 4.0 -> GPLv3 compatibility is one-way: "you may license your contributions to adaptations of BY-SA 4.0 materials under GPLv3, but you may not license your contributions to adaptations of GPLv3 projects under BY-SA 4.0"; no non-CC licenses are designated compatible with BY-NC-SA 4.0. — [Creative Commons: compatible licenses](https://creativecommons.org/share-your-work/licensing-considerations/compatible-licenses/)

Tooling (GitHub API, 2026-10-02):

- `license-checker` (npm; davglass/license-checker) — last push 2024-01-29, effectively unmaintained. — [davglass/license-checker](https://github.com/davglass/license-checker)
- `licensee` — Ruby gem/CLI that detects a project's own license (SPDX) from LICENSE files/manifests; it is what GitHub uses for repo license detection (detects, does not audit deps). — [licensee/licensee](https://github.com/licensee/licensee)
- REUSE (FSFE): put license texts in `LICENSES/` by SPDX id; per-file `SPDX-FileCopyrightText` and `SPDX-License-Identifier`; `REUSE.toml` (spec 3.2, replacing `.reuse/dep5`) for files that can't carry headers (JSON, images, datasets); `reuse lint` checks compliance. — [REUSE FAQ](https://reuse.software/faq/); [fsfe/reuse-tool](https://github.com/fsfe/reuse-tool)
- OSS Review Toolkit (ORT) — open-source compliance suite, actively maintained. — [oss-review-toolkit/ort](https://github.com/oss-review-toolkit/ort)
- FOSSA CLI — dependency license and vulnerability scanning (commercial service with OSS CLI). — [fossas/fossa-cli](https://github.com/fossas/fossa-cli)

### Inferences

- For a pnpm monorepo, `pnpm licenses list` (built in) plus a CI allow-list (MIT, ISC, BSD-2/3, Apache-2.0, 0BSD, MPL-2.0, CC0, Unlicense, BlueOak) is a low-cost baseline; ORT or FOSSA for SBOM/compliance if a hosted offering needs auditable reports. REUSE for the repo's own files and especially for bundled data files (via `REUSE.toml`).
- Bundled datasets should live in a separate directory with their own license (ODbL/CC-BY-SA), not be relicensed under the code license. Keep provenance (source, version, license, attribution string) per dataset — aligns with the app's provenance principles.
- ODbL share-alike triggers on publicly used _adapted databases_; if the hosted offering enriches/merges OFF data into its own food DB and serves it, that adapted DB may need to be offered under ODbL. COUNSEL.
- Avoid CC BY-NC datasets entirely if a hosted/commercial offering is possible.
- Watch for GPL/AGPL/LGPL/SSPL transitive deps in the JS ecosystem (rare but present, e.g. some charting/PDF libs); LGPL in a JS bundle has ambiguous "relinking" semantics — COUNSEL if any appear.

### Gaps

- USDA FoodData Central licensing (commonly described as public domain/CC0) not verified from a primary USDA page this session.
- GNU license-list entries (ODbL, CC BY-NC, ISC) not retrievable (gnu.org 429).
- No live scan of the actual openhealth dependency tree was performed.

## 5. OSI open source vs source-available (FSL, BSL, Elastic/SSPL) and community perception

### Takeaway

FSL, BSL, SSPL, and the Elastic License are not OSI-approved and are not "open source" under the OSD because of field-of-use (no-compete) restrictions; FSL's two-year conversion to Apache/MIT softens this. For a free, privacy-first health app whose pitch is self-hosting and trust, source-available licensing is a weaker signal than AGPL, and history (Elastic returning to AGPL; HashiCorp/Redis-type backlash) shows reputational cost.

### Cited Findings

- FSL: non-competing use permitted from day one; converts to Apache-2.0 or MIT after two years; designed because BSL's Additional Use Grant varied across MariaDB, Redis, HashiCorp. — [TechCrunch](https://techcrunch.com/2023/11/20/with-functional-source-license-sentry-wants-to-grant-developers-freedom-without-harmful-free-riding/); [InfoQ](https://www.infoq.com/news/2023/12/functional-source-license/)
- FSL Competing Use clause text — [Sentry LICENSE.md](https://github.com/getsentry/sentry/blob/master/LICENSE.md)
- Sentry rebranded to "Fair Source", acknowledging it is distinct from open source. — [Sentry is now Fair Source](https://blog.sentry.io/sentry-is-now-fair-source/); [TechCrunch 2024-09-22 on fair source](https://techcrunch.com/2024/09/22/some-startups-are-going-fair-source-to-avoid-the-pitfalls-of-open-source-licensing/)
- Elastic re-added AGPL in 2024, framing it as reintroducing "an OSI-approved open source license". — [Elastic](https://www.elastic.co/about/open-source); [DevClass](https://www.devclass.com/databases/2024/09/02/elasticsearch-will-be-open-source-again-as-cto-declares-changed-landscape/1618331)
- OSI's FAQ position: "open source" means OSD-compliant/OSI-approved licenses. — [OSI FAQ](https://opensource.org/faq)
- Conference talk (IndiaFOSS 2026 CFP) critiquing whether "Fair Source" is fair — evidence of ongoing community skepticism. — [FOSS United CFP](https://fossunited.org/c/indiafoss/2026/cfp/65csphmuup)

### Inferences

- Comparison summary for openhealth:
  - **AGPLv3**: strongest protection against a closed hosted fork; standard in self-hosted niche; some corporate users ban it (Google); App Store needs care; CLA question is central.
  - **GPLv3**: protects distributed binaries (mobile app, desktop) but not SaaS — a third party could run a modified hosted openhealth without sharing changes. Weak fit for the server.
  - **MPL-2.0**: file-level copyleft; modifications to openhealth files must be shared when distributed, but no network clause; good candidate for shared packages/SDK or the mobile client.
  - **Apache-2.0**: permissive + explicit patent grant; maximum adoption; no protection against closed hosted forks (Home Assistant pattern; relies on brand/trademark).
  - **MIT**: like Apache without patent grant; Umami/Actual/Cal.diy pattern.
  - **FSL/BSL/Elastic**: protects a hosted business; not open source; likely to reduce trust and contributions for a privacy-sensitive, community-oriented health app.
- A common hybrid that fits openhealth's goals: AGPLv3 server + web; MPL-2.0 or Apache-2.0 for the mobile app and any client SDK/schemas; data under its upstream licenses; trademark policy for the "openhealth" name (Bitwarden shows trademark is a separate lever from copyright). Decide CLA vs DCO before the first external PR — retrofitting is hard.
- Trademark policy is often the most effective protection of a hosted offering's brand, independent of copyright license.

### Gaps

- No primary OSI statement specific to FSL was retrieved (search results paraphrased OSI's position on SSPL/BSL; treated as consistent with OSD but not quoted).
- HashiCorp BSL / OpenTofu and Redis relicensing reactions not researched with primary sources in this session.
- Any jurisdiction-specific issues (EU, health-data regulation) affecting license choice are out of scope and should be reviewed by COUNSEL.
