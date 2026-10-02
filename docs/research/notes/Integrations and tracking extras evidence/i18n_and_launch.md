# Internationalization and Open-Source Launch Surfaces for openhealth (as of 2026-10-02)

Scope: inputs for rewriting ticket #67 (i18n) and ticket #66 (landing page, README, screenshots). Stack: React + TanStack Router web (apps/web), Expo/React Native (apps/native), oRPC, bun. License AGPLv3 + DCO. Maintainer in Lisbon.
Research date: 2026-10-02. Tool budget was limited, so some claims come from secondary sources and are flagged as such.

## Q1: i18n library choice for shared web + React Native (i18next vs Lingui vs FormatJS vs Paraglide), and Hermes Intl support

### Takeaway
On Hermes the blocker is `Intl.PluralRules`. Hermes's documented Intl support covers Collator, NumberFormat and DateTimeFormat only. Every library choice therefore needs a PluralRules (and Locale) polyfill on native, or the new `hermes-intl` native module. Lingui (ICU, compiled, about 2 kB core, built-in extraction, official RN tutorial) is the best technical fit for a web + RN codebase that needs correct plurals. i18next stays the lowest-friction choice for "translators edit JSON key files". Paraglide has no official RN adapter, so it is ruled out.

### Cited Findings
- Hermes's documented Intl support is Intl.Collator, Intl.NumberFormat, Intl.DateTimeFormat, Intl.getCanonicalLocales and the locale-aware String/Array/Number/Date methods. PluralRules, RelativeTimeFormat, ListFormat, Locale, DisplayNames and Segmenter are not listed. — [Hermes IntlAPIs.md](https://github.com/facebook/hermes/blob/main/doc/IntlAPIs.md)
- On iOS, Hermes's NumberFormat does not support `notation: 'compact'`/`'engineering'`, `compactDisplay` or `signDisplay`. DateTimeFormat lacks `numberingSystem` and `formatMatcher`. On Android, behavior varies by SDK version because Hermes uses platform APIs instead of bundling ICU. — [Hermes IntlAPIs.md](https://github.com/facebook/hermes/blob/main/doc/IntlAPIs.md)
- i18next JSON v4 plurals use `Intl.PluralRules`, with suffixes `_one`, `_other`, `_few`, `_many` and so on. The docs say: "You may need to polyfill the Intl.PluralRules API (e.g. React Native on Hermes)." Since v24 there is no fallback: without Intl, only English-style `_one`/`_other` resolve. ICU syntax requires the `i18next-icu` plugin. — [i18next JSON format](https://www.i18next.com/misc/json-format)
- FormatJS publishes `@formatjs/intl-pluralrules` and `@formatjs/intl-locale` polyfills, the standard fix for RN 0.7x Hermes. — [FormatJS intl-pluralrules](https://formatjs.github.io/docs/polyfills/intl-pluralrules/)
- `hermes-intl` (magrinj, a third-party project) is a native ICU4X-backed implementation of PluralRules, RelativeTimeFormat, ListFormat and Locale for Hermes. It requires RN 0.86+ with the New Architecture and claims to be 200–800x faster than the FormatJS polyfills. It is a young project (v0.1.x). — [magrinj/hermes-intl](https://github.com/magrinj/hermes-intl)
- Lingui 6.0 was announced in April 2026. It uses ICU MessageFormat, and `@lingui/core` is about 2 kB at runtime with no runtime parser because messages are compiled at build time. The CLI extracts messages to catalogs (PO by default) and compiles them to JS. Message IDs can be generated from source text. RN is supported with the same workflow. — [Lingui intro](https://lingui.dev/introduction); [Lingui RN tutorial](https://lingui.dev/tutorials/react-native)
- Paraglide JS 2.0 is a compiler-based, tree-shakable, type-safe library. It claims about 47 KB vs i18next's 205 KB for 5 locales and 200 messages. It has no official React Native adapter as of April 2026 (secondary source). — [paraglide-js GitHub](https://github.com/opral/paraglide-js); [simplelocalize comparison](https://simplelocalize.io/blog/posts/the-most-popular-react-localization-libraries/)
- Mastodon's web UI uses react-intl (FormatJS) with Crowdin-synced locale files. Immich uses ICU message format via `intl-messageformat`. — [Mastodon crowdin.yml](https://github.com/mastodon/mastodon/blob/main/crowdin.yml); [Immich translations docs](https://docs.immich.app/developer/translations/)

### Inferences
- Pick the library based on whether you want ICU messages, not on bundle size. A health app needs correct plurals ("1 dose" / "2 doses") and select/gender for languages like Portuguese, Spanish, German and Polish. Lingui, react-intl and i18next+i18next-icu all give ICU. Plain i18next uses suffix keys instead, which Weblate and Crowdin also handle.
- The ticket's "add a language with no code change" goal fits i18next or react-intl, which load JSON at runtime. Lingui compiles catalogs at build time, so a new language needs a rebuild but not a code edit. The ticket should say "no code change; release required".
- Whatever library is chosen, #67 should include a native bootstrap step: polyfill `Intl.PluralRules` and `Intl.Locale` (plus RelativeTimeFormat if "3 days ago" is used) from FormatJS on Hermes, or adopt `hermes-intl` once the Expo SDK is on RN ≥0.86. Add a unit test that runs plural selection for pt/pl/ar under Hermes.
- For type-safe keys: i18next supports TypeScript resource typing, and Lingui extracts from source. Both are workable. A CI missing-key check is natural with either (`lingui extract --clean` plus diff, or i18next-parser/i18next-cli).
- Do not use Intl for medication names. They are data, not UI strings, and should not be translated by the i18n layer.

### Gaps
- I did not verify which RN version the current Expo SDK ships (needed to know whether `hermes-intl` is usable) or whether Expo now enables Hermes Intl extensions. Check the Expo changelog.
- I did not fetch exact current bundle sizes for i18next/react-i18next and react-intl from bundlephobia or pkg-size.
- I did not confirm Lingui 6 breaking changes or Lingui's own recommendation on Hermes polyfills.

## Q2: OSS translation workflow (Weblate, Crowdin, Tolgee, Pontoon) and how peers do it; AGPL + DCO for translations

### Takeaway
Hosted Weblate's Libre plan is free for public libre projects. It is itself GPL software, and it supports a DCO-style contributor agreement plus a `Signed-off-by: {{ author }}` commit-message template, which suits an AGPL + DCO repo. Crowdin's OSS license is also free, but its conditions bar related commercial products and require contributing translations to Crowdin's global translation memory. Immich (closest peer) uses Weblate. Mastodon and Mealie use Crowdin, Home Assistant uses Lokalise, Nextcloud uses Transifex.

### Cited Findings
- Hosted Weblate pricing page: the Libre plan is gratis, "only for public projects", with the same 160k hosted-string allowance as the paid 160k plan: "If you feel that being supported by Weblate will help your libre project, set it up and get the Libre plan gratis." — [weblate.org/en/hosting](https://weblate.org/en/hosting/)
- Weblate is GPLv3-or-later (some modules MIT/ISC) and REUSE-compliant. — [Weblate license docs](https://docs.weblate.org/en/latest/contributing/license.html)
- Weblate docs say that if a project requires a `Signed-off-by` header, you turn on a contributor license agreement containing the DCO text and add `Signed-off-by: {{ author }}` to the commit message template. Only users who accepted the agreement can then contribute. Current docs also say: "You should avoid requiring a contributor license agreement, though it is possible." — [Weblate 3.9.1 licensing docs](https://docs.weblate.org/en/weblate-3.9.1/admin/licensing.html); [current licensing docs](https://docs.weblate.org/en/latest/admin/licensing.html)
- Crowdin OSS license conditions: an OSI-approved license, publicly available source, "no commercial products related to the open-source project", the requester is project lead, at least 3 months of work, and an active community. It grants unlimited projects, strings and members. By applying you agree to join the Crowdin beta group and to contribute translations to Crowdin Global TM. — [Crowdin OSS request form](https://crowdin.com/page/open-source-project-setup-request) (via search snippet)
- Immich manages translations on Hosted Weblate. It uses ICU format, new languages are requested through Weblate, and Weblate opens automated "chore(web): update translations by weblate" PRs. — [Immich translations docs](https://docs.immich.app/developer/translations/); [example PR](https://github.com/immich-app/immich/pull/31376)
- Mastodon uses Crowdin, with "New Crowdin Translations (automated)" PRs from github-actions. — [Mastodon PR #40819](https://github.com/mastodon/mastodon/pull/40819); [crowdin.yml](https://github.com/mastodon/mastodon/blob/main/crowdin.yml)
- Mealie uses Crowdin, pulled regularly and shipped with each release. — [Mealie translating docs](https://docs.mealie.io/contributors/translating/)
- Home Assistant uses Lokalise, split into backend, frontend and two companion-app projects. — [HA developer docs: translations](https://developers.home-assistant.io/docs/translations/)
- Nextcloud uses Transifex. — [nextcloud.com/translation](https://nextcloud.com/translation/)

### Inferences
- For an AGPL + DCO project, Hosted Weblate is the most aligned choice. Its GPL/libre ethos matches, there is no global-TM contribution clause, and it can add DCO sign-off natively. The ticket's "PRs of JSON files" path can coexist with it: Weblate pushes to a branch and opens PRs, and the DCO check passes if the sign-off template is configured.
- If the project ever offers a paid hosted tier, Crowdin's "no commercial products" condition could disqualify it. Weblate's stated condition is only "public projects".
- Weblate commits carry the translator as author, so per-translator sign-off is possible. Check that the DCO bot accepts the Weblate committer identity, and that the "Signed-off-by" email matches the author.

### Gaps
- I could not load Hosted Weblate's detailed libre-eligibility terms (hosted.weblate.org/hosting returned 403). Requirements beyond "public project" (OSI license, activity, link-back, approval time) are unverified. One GitHub issue mentions a "14-day setup/approval", but that is not authoritative.
- Not researched: Tolgee and Pontoon OSS terms.
- I did not find an authoritative statement on how translations are licensed under AGPL by default. The usual practice is inbound=outbound under the project license, made explicit in the Weblate component's "license" field.

## Q3: Locale specifics for health (pt-PT vs pt-BR, units, dates, RTL)

### Takeaway
Language, region formatting and clinical units should be three separate settings. Glucose and cholesterol units (mg/dL vs mmol/L), weight and temperature vary by country and lab, not by language. The maintainer is in Portugal and pt-PT differs from pt-BR, so seed `pt-PT` (or both) rather than only `pt-BR`.

### Cited Findings
- Hermes DateTimeFormat and NumberFormat are platform-backed, and output can differ between iOS and Android and across Android SDK versions. — [Hermes IntlAPIs.md](https://github.com/facebook/hermes/blob/main/doc/IntlAPIs.md)
- i18next plural resolution depends on per-language `Intl.PluralRules` categories, which differ between languages. — [i18next JSON format](https://www.i18next.com/misc/json-format)

### Inferences (not sourced in this pass; general domain knowledge, verify before stating as fact)
- pt-PT and pt-BR differ in vocabulary, spelling and formality. Treat them as two catalogs with `pt` fallback only if unavoidable. Since the maintainer is in Lisbon, seeding pt-PT is cheap, high-quality coverage.
- Store lab values in their original unit with provenance, and convert only for display based on a user "units" preference. Glucose (mg/dL vs mmol/L, factor about 18.0) and cholesterol (factor about 38.67) conversions must be analyte-specific. Never derive units from the UI language.
- Week start and date order should come from the region or locale (e.g., `pt-PT` uses Monday and dd/mm/yyyy), ideally with a user override.
- Deferring RTL is acceptable if the code uses logical CSS properties (`margin-inline-start`) and RN `I18nManager`-aware styles from the start. Retrofitting later is costlier.

### Gaps
- I did not fetch CLDR data on week-start per region, or a primary source on mg/dL vs mmol/L usage by country (e.g., a lab-medicine society or IFCC). Get these before encoding defaults.
- I did not check `Intl.Locale.prototype.getWeekInfo` availability. It is not listed in Hermes and needs a polyfill.

## Q4: Safety of machine and community translation for health copy

### Takeaway
Authoritative health bodies treat unreviewed machine translation of patient-facing health information as unsafe. NHS England reportedly does not recommend it, and US ACA §1557 rules require human review of machine translations for covered entities. The app should label locales as "community, unreviewed" vs "reviewed", and keep safety-critical strings (units, reference-range flags, dosing labels) under stricter review.

### Cited Findings
- A 2025 npj Digital Medicine paper on operationalizing machine-assisted translation in healthcare says that under ACA Section 1557 (US), machine-generated translations must undergo human review before reaching patients, and that no detailed federal or professional guidance exists on operationalizing LLM-based translation. — [Nature npj Digit Med 2025](https://www.nature.com/articles/s41746-025-01944-0) / [PMC](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12485017/)
- An NHS commissioning-support report states that NHS England does not recommend machine translation because of clinical-accuracy concerns (search snippet; not opened in full). — [SCW CSU community languages report](https://scwcsu.nhs.uk/doclink/community-languages-translation-and-interpreting-services-report/eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjb21tdW5pdHktbGFuZ3VhZ2VzLXRyYW5zbGF0aW9uLWFuZC1pbnRlcnByZXRpbmctc2VydmljZXMtcmVwb3J0IiwiaWF0IjoxNzQzMTU1NzEwLCJleHAiOjE3NDMyNDIxMTB9.8ix5YtHMIn-9Afng33Rm10UctuCWjMoZINScB5Uc99o)
- Studies found ChatGPT and Google Translate produced nonsensical or fabricated words in Amharic, Tigrinya and Somali discharge instructions. — [EthnoMed](https://ethnomed.org/resource/are-machine-translations-safe-to-use-for-patient-discharge-instructions/)
- Weblate supports machine-translation suggestions (automatic suggestions) that humans then accept, and has review workflows. — [Weblate automatic suggestions docs](https://docs.weblate.org/en/latest/admin/machine.html)

### Inferences
- ACA §1557 and EU MDR labeling-language obligations (MDR Art. 10(11)) apply to covered healthcare entities and to medical devices respectively. A self-hosted wellness app positioned as not a medical device is likely outside both, but they show the expected standard of care.
- Recommended ticket requirements: enable Weblate's "reviewed" state (or an equivalent), show a per-locale badge such as "Community translation, not medically reviewed", fall back to English for any string marked safety-critical but not reviewed, and never translate lab analyte codes, units or medication names.

### Gaps
- I did not open the NHS England primary policy document. The NHS claim comes via a CSU report snippet.
- I did not verify the exact current text of MDR Art. 10(11) or Annex I §23.

## Q5: App store localization implications (minimal)

### Takeaway
Store listings are localized separately from the in-app catalog. Apple accepts 1–10 screenshots per display size per localization, and one 6.9" iPhone set (1320×2868) is the only mandatory iPhone size.

### Cited Findings
- 6.9" iPhone screenshots at 1320×2868 (also accepting 1290×2796 and 1260×2736) are the required iPhone slot. iPad apps also need 13" at 2064×2752 or 2048×2732. 1–10 screenshots per display class per localization, in JPEG or PNG. Secondary sources only. — [ScreenKit spec](https://screenkit.tools/specs/app-store-screenshot-sizes); [AppLaunchFlow](https://www.applaunchflow.com/app-store-screenshot-sizes)

### Inferences
- Generate per-locale store screenshots from the same fixture pipeline (see Q10). Localize store metadata only for reviewed locales.

### Gaps
- I did not open Apple's primary "Screenshot specifications" page or Google Play's asset requirements.

## Q6: How comparable OSS self-hosted projects present landing pages, READMEs and installs

### Takeaway
The peer pattern is a separate marketing/docs site plus a README with a docker compose quickstart. Immich explicitly calls Docker Compose "the recommended method to run Immich in production" and labels its install script "[Experimental]".

### Cited Findings
- Immich: "Docker Compose is the recommended method to run Immich in production." Its install script is listed as "Install script [Experimental]". — [Immich Docker Compose docs](https://docs.immich.app/install/docker-compose/)
- Mastodon keeps a separate marketing repo/site (joinmastodon.org) apart from the app repo. — [mastodon/joinmastodon](https://github.com/mastodon/joinmastodon)

### Inferences
- A separate static site (docs + landing) keeps the self-hosted app free of marketing routes and trackers, and lets the landing page ship without auth or PHI code paths.
- A public demo instance of a health app must be synthetic-only, reset regularly, and have write paths or uploads disabled or sandboxed.

### Gaps
- Within the tool budget I did not research Plausible, Cal.com, Paperless-ngx, Actual Budget or Mealie landing and demo setups (e.g., whether each runs a public demo, and how screenshots are produced). This needs a follow-up pass.

## Q7: `curl | bash` vs docker compose quickstart

### Takeaway
Lead with a pinned docker compose file and a `.env.example`. If a script is offered, label it optional or experimental, and tell users to download, inspect, then run it (with a checksum), rather than piping to a shell.

### Cited Findings
- `curl | bash` gives no integrity verification and execution starts before the download completes. A server can detect piping (via timing or sleep tricks) and serve different content. A compromised or DNS-hijacked host means RCE on every installer. — [Ariscodes blog](https://blog.ariscodes.com/blog/en-us/curl-bash-pipe-security/); [tferdinand.net](https://tferdinand.net/en/why-curl-bash-is-a-dangerous-bad-habit/); [lesinskis.com](https://www.lesinskis.com/dont-pipe-curl-into-bash.html) (practitioner blogs, not standards bodies)
- The suggested safer pattern is `curl -f URL > install.sh`, review the file, then run it. — [sasha.vincic.org](https://sasha.vincic.org/blog/2024/09/piping-curl-to-bash-convenient-but-risky)
- Immich (a reputable peer) recommends docker compose and labels its script experimental. — [Immich docs](https://docs.immich.app/install/docker-compose/)

### Gaps
- I found no standards-body guidance (e.g., OpenSSF) specific to install scripts within budget.

## Q8: Privacy of the landing page (third-party fonts, CDNs, analytics)

### Takeaway
Self-host fonts and assets. LG München (3 O 17493/20, 20 Jan 2022) awarded €100 damages because embedding Google Fonts transmitted visitors' IPs to Google without consent, and a cost-free privacy-neutral alternative (local hosting) existed. Use either no analytics or cookieless, self-hosted analytics.

### Cited Findings
- On 20 January 2022, LG München I (3 O 17493/20) held that passing visitors' dynamic IPs to Google via remotely embedded Google Fonts without consent violated GDPR and awarded €100 non-material damages. The court noted fonts can be self-hosted, so there was no legitimate interest. The ruling triggered waves of warning letters in Germany. — [KPMG Law](https://kpmg-law.de/en/google-fonts-warning-wave-massive-warnings-and-claims-for-damages-due-to-alleged-dsgvo-violation/); [dr-dsgvo.de](https://dr-dsgvo.de/google-fonts-urteil-rechtskraeftig-auswirkungen/)

### Inferences
- The landing page should have no third-party requests at all: self-hosted fonts, no CDN JS, no embedded YouTube or maps without click-to-load. This is also good optics for a privacy-first health app.
- Analytics options: none, server-log-based stats, or self-hosted cookieless tools (Plausible CE, Umami, GoatCounter). Never add analytics inside the app itself.

### Gaps
- I did not fetch the ruling text itself (only legal-commentary sources), nor any later CJEU or BGH developments on Google Fonts mass claims.
- I did not verify Plausible, Umami or GoatCounter licensing or cookie behavior in this pass.

## Q9: Health-claims rules for marketing copy (EU MDR intended purpose, FTC, FDA)

### Takeaway
In the EU, qualification as medical-device software turns on the manufacturer's intended purpose, and that includes marketing claims. Copy like "detects", "diagnoses", "predicts risk" or "guides treatment" can pull the app into MDR. Purely lifestyle or wellness purposes do not qualify. In the US, the FTC's Health Products Compliance Guidance (Dec 2022) expressly covers health apps and requires competent and reliable scientific evidence for health claims. The FDA's General Wellness guidance was revised on 6 Jan 2026.

### Cited Findings
- MDCG 2019-11 decides whether software is a medical device largely on intended purpose (what you claim), not how it works. Rev.1 (June 2025) added wellness and lifestyle borderline examples and clarified that software with exclusively administrative, lifestyle or wellness purposes is not MDSW. — [OpenRegulatory MDCG 2019-11](https://openregulatory.com/mdcg/mdcg-2019-11); [Emergo by UL on Rev.1](https://www.emergobyul.com/news/european-revision-primary-software-guidance-mdcg-2019-11-revision-1-small-changes-meaningful)
- The FTC Health Products Compliance Guidance (Dec 2022) replaces the 1998 supplement guide and expressly applies to all health-related products, including health apps. Claims need "competent and reliable scientific evidence", generally RCT-grade for health benefits. — [FTC guidance page](https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance); [Cooley summary](https://www.cooley.com/news/insight/2023/2023-03-02-ftc-revises-health-products-compliance-guidance)
- The FDA revised its General Wellness Policy for Low Risk Devices on 6 Jan 2026, superseding the 2019 version. It keeps the two-factor test (intended only for general wellness use, and low risk) and allows certain non-invasive wearables that output physiologic parameters to qualify when intended solely for wellness. — [Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/fda-issues-revised-guidance-on-general-wellness-products); [FDA guidance page](https://fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices)

### Inferences
- Landing and README copy should describe organizing, recording and visualizing personal data, not diagnosing, detecting, predicting or recommending treatment. Avoid claims that AI summaries "interpret" labs clinically. Add a "not a medical device; not medical advice" statement, and keep the in-app wording consistent with the marketing copy, because intended purpose is read across all materials.
- Localized marketing copy must keep the same disclaimers. A translation that turns "track" into "monitor/diagnose" changes the intended purpose.

### Gaps
- I did not read the MDCG 2019-11 Rev.1 PDF directly (secondary summaries only).
- Not covered: EU AI Act implications of AI-assisted review, or the FTC Health Breach Notification Rule (relevant if any analytics or data sharing exists).

## Q10: Screenshot pipeline with synthetic data

### Takeaway
Generate every screenshot from a deterministic synthetic-fixture seed: Playwright for web, and a mobile E2E runner (Maestro or Detox) for native. Render at the store-required sizes per locale, and never capture from a real account.

### Cited Findings
- Apple requires the 6.9" set at 1320×2868, per localization, 1–10 images (secondary sources). — [ScreenKit](https://screenkit.tools/specs/app-store-screenshot-sizes)

### Inferences
- Ticket #66 should require a `seed:demo` fixture (fictional person, plausible labs with units, a medication schedule using generic placeholder names) shared by screenshots, the demo instance and docs. Run it in CI so screenshots regenerate on UI change, and add a PHI lint (no real names or emails) for the fixtures.

### Gaps
- I did not research current Maestro and Detox capabilities, Expo compatibility, or fastlane snapshot/screengrab in this pass.
