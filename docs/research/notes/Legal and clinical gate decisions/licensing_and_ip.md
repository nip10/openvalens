# Licensing and IP decisions for openhealth (AGPL-3.0-or-later, EU/Portugal maintainer), researched 2026-10-02

Scope: app-store exception (#56), trademark policy (#56), name clearance, Open Food Facts ODbL (#72), recipe URL import (#82), guideline-fact licensing (#97). Each section has the facts, precedent texts, a recommended decision, and one line on the risk that remains. "Verified" means the source was fetched during this research. Statements from background knowledge that were not fetched are marked **[unverified]**.

## 1. App-store exception (AGPLv3 §7 additional permission)

### Takeaway

Adopt a written §7 additional permission now, before any external contribution lands. It should permit conveying through Apple App Store, Google Play and similar stores despite their usage rules or DRM, on condition that the Corresponding Source is also available under plain AGPL through an unrestricted channel. Most large AGPL/GPL mobile apps (Signal, Element X, Threema, Nextcloud, Bitwarden, Immich) ship to the App Store with no exception at all. They can do that only because they own or control the copyright (through a CLA or a single owner). openhealth uses DCO with no CLA, so it needs the exception written down.

### Cited Findings

**The conflict (FSF view)**

- FSF (Brett Smith, 26 May 2010): App Store terms, specifically the "Usage Rules" (accepting the ToS, the five-device limit), are "exactly the kind of 'further restrictions' that are prohibited by the GPL". The key Apple clause is "The Usage Rules shall govern your rights with respect to the Products, in addition to any other terms…". Apple removed GNU Go rather than comply. — [FSF blog](https://www.fsf.org/blogs/licensing/more-about-the-app-store-gpl-enforcement)
- GPL FAQ: in GPLv3 an exception is made "by granting an additional permission under section 7". The FAQ template begins "Additional permission under GNU GPL version 3 section 7". — [GPL FAQ #GPLIncompatibleLibs](https://www.gnu.org/licenses/gpl-faq.html#GPLIncompatibleLibs)
- The GPL FAQ fetch found no FAQ entry specific to app stores. — [GPL FAQ](https://www.gnu.org/licenses/gpl-faq.html)

**What major apps actually do.** I checked each repo's licence file through the GitHub API on 2026-10-02:

- signalapp/Signal-iOS: AGPL-3.0. element-hq/element-x-ios: AGPL-3.0. threema-ch/threema-ios: AGPL-3.0. Dimillian/IceCubesApp: AGPL-3.0. immich-app/immich: AGPL-3.0. nextcloud/ios, nextcloud/talk-ios, wireapp/wire-ios, bitwarden/ios, mastodon/mastodon-ios, owncloud/ios-app: GPL-3.0. None of their LICENSE files mention the App Store. mattermost-mobile and jitsi-meet are Apache-2.0, so they have no conflict. — e.g. [Signal-iOS LICENSE](https://github.com/signalapp/Signal-iOS/blob/HEAD/LICENSE), [element-x-ios LICENSE](https://github.com/element-hq/element-x-ios/blob/HEAD/LICENSE)
- OsmAnd goes the other way and uses the stores as a restriction: "Publishing applications using the OsmAnd UI/UX code to Google Play, Amazon Market, or Apple Store must be done with written permission." — [OsmAnd LICENSE](https://github.com/osmandapp/OsmAnd/blob/HEAD/LICENSE)

**Precedent exception texts (verbatim)**

- Signal / Open Whisper Systems, libsignal-protocol-c (GPLv3): "Additional Permissions For Submission to Apple App Store: Provided that you are otherwise in compliance with the GPLv3 for each covered work you convey (including without limitation making the Corresponding Source available in compliance with Section 6 of the GPLv3), Open Whisper Systems also grants you the additional permission to convey through the Apple App Store non-source executable versions of the Program as incorporated into each applicable covered work as Executable Versions only under the Mozilla Public License version 2.0". — [libsignal-protocol-c README](https://github.com/signalapp/libsignal-protocol-c)
- Signal blog, 13 Jun 2016: "Applications that comply with the GPL are now explicitly authorized to be distributed through the Apple App Store and remain in compliance with the license." — [signal.org](https://signal.org/blog/license-update/)
- Counter-example: the current Rust libsignal (AGPL-3.0) has no such permission. Issue #684, "App Store distribution permission for AGPL libsignal", has been open since 2026-07-10 with no maintainer answer in the comments I read, and downstream apps say it blocks them. — [libsignal#684](https://github.com/signalapp/libsignal/issues/684). Lesson: a blog statement does not substitute for licence text, and downstream projects need the text.
- SonoBus (GPLv3), also used verbatim by Voiceliner: "As additional permission under section 7, you are allowed to distribute the software through an app store, even if that store has restrictive terms and conditions that are incompatible with the GPL, provided that the source is also available under the GPL with or without this permission through a channel without those restrictive terms and conditions." — [sonobus LICENSE_EXCEPTION](https://github.com/sonosaurus/sonobus/blob/HEAD/LICENSE_EXCEPTION); [voiceliner COPYING](https://github.com/maxkrieger/voiceliner/blob/HEAD/COPYING)
- libsignal_dart (AGPL variant of the SonoBus text), headed "Additional permission under GNU AGPL version 3 section 7 (app store distribution)". It also has a Scope clause: "applies only to the code in this repository… It does not — and cannot — grant any permission on behalf of third parties with respect to separately licensed components." — [libsignal_dart LICENSE.appstore](https://github.com/djx-y-z/libsignal_dart/blob/HEAD/LICENSE.appstore)
- Sky Map / stardroid (GPLv3) has the most explicit wording. It permits conveying "through an application distribution service or platform — including without limitation the Apple App Store, Google Play, and comparable services — notwithstanding that the terms of service of such a platform impose restrictions on recipients' exercise of the rights granted by this License, including without limitation: (a) restrictions on redistribution or further conveyance of the conveyed copy; (b) limits on the number of devices or accounts…; (c) a requirement that recipients accept the platform operator's terms of service; and (d) technical measures that control the installation or execution of the conveyed copy. This additional permission applies solely to conveyance through such a platform. It does not restrict any other right granted by the License, and it does not affect the availability of the Corresponding Source… As provided in section 7 of the License, you may remove this additional permission from any copy…" — [stardroid LICENSE.md](https://github.com/sky-map-team/stardroid/blob/HEAD/stardroid-v2/LICENSE.md)
- RHVoice: "As an additional permission under Section 7 of the GNU General Public License version 3, you may distribute this software and any work based on this software… through Apple's App Store. If any condition of the GNU General Public License version 3 conflicts with the terms and conditions governing distribution through Apple's App Store, any such condition is waived… All other terms and conditions… continue to apply… This includes the requirement that anyone distributing a work based on this software must provide the complete Corresponding Source". — [RHVoice LICENSE_APPLE_APP_STORE.md](https://github.com/RHVoice/RHVoice/blob/HEAD/LICENSE_APPLE_APP_STORE.md)
- Blink Shell uses a non-enforcement covenant rather than a §7 permission: "we have committed not to pursue any license violation that results solely from the conflict between the GPLv3 and the Apple App Store terms of service… as long as you comply with the GPL in all other respects, including its requirements to provide users with source code". — [blink COPYING](https://github.com/blinksh/blink/blob/HEAD/COPYING)

**DCO coverage**

- DCO 1.1(a): "The contribution was created in whole or in part by me and I have the right to submit it under the open source license indicated in the file". — [developercertificate.org](https://developercertificate.org/). A sign-off therefore covers whatever licence the repo indicates. If the indicated licence is "AGPL-3.0-or-later plus the additional permission in LICENSE-APP-STORE", contributors submit under both.

### Inferences

- **Recommended text.** This merges SonoBus, stardroid and libsignal_dart and adapts them to AGPL. Save it as `LICENSE-APP-STORE` at the repo root:

  > **Additional permission under GNU AGPL version 3 section 7 (application store distribution)**
  >
  > As an additional permission under section 7 of the GNU Affero General Public License version 3, the copyright holders of openhealth grant you permission to convey the Program, or a work based on the Program, in object code form through an application distribution platform (including without limitation the Apple App Store, Google Play, and comparable services), notwithstanding that the terms of service, usage rules, or technical measures of such a platform impose restrictions on recipients' exercise of the rights granted by this License, including (a) limits on redistribution or further conveyance of the conveyed copy, (b) limits on the number of devices or accounts on which it may be installed or used, (c) a requirement that recipients accept the platform operator's terms, and (d) technical measures that control installation or execution of the conveyed copy;
  >
  > provided that (1) you comply with this License in all other respects, and (2) the Corresponding Source of the exact version you convey is also available, under this License with or without this permission, free of charge through a channel that does not impose those restrictions (for example, a public source repository), and the conveyed app or its store listing gives recipients a notice of how to obtain it.
  >
  > This permission applies only to conveyance through such platforms. It covers only material whose copyright holders have granted it. It does not and cannot grant permission for separately licensed components. As provided in section 7, you may remove this additional permission from any copy of the Program, or any part of it, that you convey.

- **Rules to adopt with it.**
  1. Commit the exception before merging the first external PR. Add it to `CONTRIBUTING.md`: "By signing off (DCO) you license your contribution under AGPL-3.0-or-later together with the additional permission in LICENSE-APP-STORE."
  2. Name the licence in every file header, e.g. `SPDX-License-Identifier: AGPL-3.0-or-later` plus a pointer to LICENSE-APP-STORE. The SPDX exceptions list probably has no ID for this text, so use a `LicenseRef-`/`AdditionRef-` custom identifier or the plain pointer **[unverified: check the current SPDX list and the AdditionRef syntax]**.
  3. Audit the mobile dependency tree. Any third-party GPL/AGPL component without such a permission would block store distribution, as libsignal shows. Permissive (MIT/Apache) dependencies are fine.
  4. Any code copied in from other AGPL projects must carry the same permission, or it cannot go into the mobile app.
  5. Link the source repo from inside the app and from the store listing.
- **Why the exception still matters** even though Signal and others ship without one: they rely on owning the copyright. Under DCO-only, every contributor keeps their copyright, so the maintainer cannot later grant this permission for code they do not own.
- **Residual risk:** forks may strip the permission (§7 allows it), and a hostile third-party contributor's code is covered only by what they signed off. The risk is low if the exception exists before the first contribution.

### Gaps

- I did not fetch the current Apple Media Services Terms or Standard EULA, so I cannot confirm whether the "Usage Rules" wording the FSF quoted in 2010 is still present.
- The VLC iOS removal in January 2011 (complaint by a VLC copyright holder; later relicensing of libVLC to LGPL) is background knowledge only **[unverified]**.
- No SFC/FSF statement on Google Play specifically was found.
- No FSF FAQ entry addresses whether a recipient can remove permissions. That point comes from GPLv3 §7 itself and the stardroid and libsignal_dart texts.

## 2. Trademark policy template

### Takeaway

Use a short `TRADEMARK.md` modelled on Matomo's policy, which is CC-BY-SA and derived from Ubuntu's, and on the Model Trademark Guidelines. Nominative use and unmodified redistribution should be free. Modified or forked builds and any hosted or commercial service must rename. Logos and domains need permission.

### Cited Findings

- Matomo's policy has these headings: The Trademarks, Permitted Use, Restricted Use Requiring License, Logo Usage Guidelines, Summary.
  - Permitted: community and non-commercial reference that does not imply affiliation; minimally customised non-commercial "remixes"; "XYZ Integration for Matomo" and "Powered by Matomo"; commentary and parody.
  - Restricted: commercial use, commercial products built on Matomo, domain names, merchandise, names combining MATOMO with other terms, and substantially modified versions.
  - The policy is "published under the CC-BY-SA license, and based on the Ubuntu project's trademark policy". — [matomo.org/trademark](https://matomo.org/trademark/)
- I could not fetch modeltrademarkguidelines.org because its TLS certificate is for `*.web-hosting.com`. The only GitHub mirror found, daniel-barrows/Model-Trademark-Guidelines, contains only a stub README. — [GitHub](https://github.com/daniel-barrows/Model-Trademark-Guidelines)

### Inferences

- **Recommended TRADEMARK.md** (about 1 page, CC-BY-SA if you adapt Matomo's text, with attribution):
  1. _Scope._ The marks are the [NAME] word mark and logo. The code licence (AGPL) grants no trademark rights; AGPLv3 §7(e) lets licensors decline trademark rights.
  2. _OK without asking._ Truthful references ("works with [NAME]", "[NAME] integration"); redistributing **unmodified** official releases under the same name; community, educational and press use; a "Powered by [NAME]" link in self-hosted instances.
  3. _Must rename._ Any modified build, fork, or app-store distribution not built from an official tag. Any hosted, multi-tenant or paid service offered to others (it may say "based on [NAME]"). App names, package IDs and domains containing the mark.
  4. _Ask first._ Logo use outside the unmodified app, merchandise, and event names.
  5. _Never._ Implying endorsement, or medical or clinical claims attributed to the project.
  6. _Contact and enforcement._ An email address, plus a statement that the project will first ask politely.
- In GPLv3/AGPLv3, §7(e) permits "Declining to grant rights under trademark law for use of some trade names, trademarks, or service marks" **[unverified quote; licence text not fetched in this session]**. Add a one-line notice in LICENSE pointing to TRADEMARK.md.
- **Residual risk:** a policy without a registered mark can be enforced only through unregistered-mark and passing-off-style rights, which are weak in Portugal or the EU without registration. That is acceptable at this stage.

### Gaps

- I did not retrieve the Mozilla, Nextcloud or Immich/FUTO policies; Matomo was used as the representative.
- I did not retrieve the Model Trademark Guidelines text (site TLS error).

## 3. Name clearance: "openhealth"

### Takeaway

**Rename before public launch.** Several parties already use "OpenHealth" for health software and apps. They include an AGPL-3.0 "OpenHealth" AI health assistant on GitHub with about 4,000 stars that is functionally very close to this project, several App Store publishers named "OpenHealth Inc" and "OpenHealth SRL" (the latter apparently in the EU), and the UK group OPEN Health with 1,000+ staff, which claims OPEN HEALTH as a registered trademark. "Open" + "health" is also close to descriptive, so the name would be hard to register or defend.

### Cited Findings

- GitHub OpenHealthForAll/open-health is "OpenHealth, AI Health Assistant", AGPL-3.0, 3,959 stars, created 2025-01-23, last pushed 2026-01-06, homepage open-health.me. It describes itself as an AI assistant using "your personal health information". — [GitHub](https://github.com/OpenHealthForAll/open-health) (stars and licence via GitHub API, 2026-10-02)
- Other GitHub projects named openHealth: garvsl/openHealth ("All in one health app and assistant") and mathbiol/openHealth. — [garvsl](https://github.com/garvsl/openHealth), [mathbiol](https://github.com/mathbiol/openHealth)
- iTunes Search API, 2026-10-02 (PT and US storefronts):
  - The app "OpenHealth: Self-help Loops" (seller Sihang Chen, Health & Fitness).
  - Seller "OpenHealth Inc": Plates: AI Calorie Tracker, Mozu: Meal Companion, FareGate, OpenIntent.
  - Seller "OpenHealth SRL": DataMed (Medical), EID0S (Food & Drink).
  - Source: `https://itunes.apple.com/search?term=openhealth&entity=software&country=pt`, queried directly.
- OPEN Health is a healthcare communications and market-access group founded in 2011, headquartered in London, with 1,000+ people and 15 offices, owned by Astorg since 2022. — [Crunchbase/search summary](https://www.crunchbase.com/organization/open-health); [openhealthgroup.com](https://www.openhealthgroup.com/). Its terms state that OPEN HEALTH and related names and logos are trademarks of the company. — [OPEN Health terms](https://www.openhealthgroup.com/legal-and-governance/terms/)
- USPTO "OPEN HEALTH" (with globe design): Reg. 4936961, registered 2016-04-12, covering distribution of medical/dental supplies and medical/dental manufacturing services. Reg. 4014747, registered 2011-08-23, covering distribution of dental supplies. — [Justia 85515571](https://trademark.justia.com/855/15/open-85515571.html); [Justia 85056681](https://trademark.justia.com/850/56/open-health-85056681.html)
- DNS on 2026-10-02: openhealth.com, openhealth.org, openhealth.io and openhealth.eu resolve, so they are registered and in use. openhealth.app, openhealth.dev and openhealth.pt returned no A record, which does not prove they are unregistered.
- The TMview API POST returned an empty response, and the web search found no EUIPO record. I could not query EUIPO, WIPO or INPI automatically.

### Inferences

- **Conflict assessment.**
  - An identical name is used for an identical category (an open-source AGPL personal-health AI app). That creates confusion and SEO collisions regardless of any registrations.
  - App Store collisions with "OpenHealth" sellers in Health & Fitness and Medical risk listing rejection or a complaint.
  - The OPEN Health group claims a mark in the health field and is large enough to send letters.
  - The USPTO registrations are for different goods (dental supply distribution), so their direct conflict risk in classes 9, 42 and 44 is low.
- **Decision:** rename now, while the cost is lowest. Keep "openhealth" only as an internal codename.
- **How to pick an alternative** (no brainstorm here):
  1. Choose a coined or arbitrary word (strong mark). Avoid "open", "health", "med", "care" and "vital" as the dominant element.
  2. Run the knockout searches below for an exact or similar mark in classes 9, 42, 44 and 10.
  3. Check the App Store and Play names (iTunes Search API), GitHub orgs and repos, npm and PyPI packages, and the .com/.app/.org/.pt domains.
  4. Check that it is not a negative word in PT, EN, ES, FR or DE.
  5. If it is clean, consider filing an EUTM in classes 9, 42 and 44. The online fee for one class is about €850, and each additional class costs more **[unverified; check the EUIPO fee page]**.
- **Manual search steps** (needed because automated queries failed):
  - TMview (covers EUIPO, INPI PT, WIPO and national offices): https://www.tmdn.org/tmview/ → search "openhealth" and "open health" → filter Nice 9, 10, 35, 42, 44 → status "Registered"/"Filed".
  - EUIPO eSearch plus: https://euipo.europa.eu/eSearch/
  - WIPO Global Brand Database: https://branddb.wipo.int/ (search brand name and similar, class filter).
  - USPTO: https://tmsearch.uspto.gov/ (wordmark "openhealth", "open health"; check live/dead; open TSDR for goods).
  - INPI Portugal: https://servicosonline.inpi.pt/pesquisas/ (Marcas).
  - Record screenshots and dates in the decision log.
- **Residual risk (if kept):** probable confusion with the AGPL OpenHealth project and App Store sellers; possible complaint from OPEN Health. If renamed, the remaining risk is whatever the new name's knockout search misses.

### Gaps

- No EUIPO, WIPO or INPI result could be retrieved, and the USPTO view comes only from Justia via search. I did not determine whether any EUTM "OPENHEALTH" exists in classes 9, 42 or 44. That must be checked manually as above.
- I did not identify the jurisdiction of OpenHealth SRL (SRL suggests Italy or Romania).
- I did not check Google Play app names.

## 4. Open Food Facts and ODbL

### Takeaway

An unmodified OFF mirror kept in its own table is "this Database in unmodified form". Placed next to an independent USDA FDC (CC0) table, it forms a **Collective Database**, and that does not pull FDC, app code or user data under ODbL (§4.5a). Any filtering, transformation, merging or matching of OFF data creates a **Derivative Database**. If it is Publicly Used, which a hosted multi-tenant service displaying it to users is, then that derivative (or an alteration file or method) must be offered under ODbL (§4.4, §4.6). Per-user nutrition logs that reference OFF products are Produced Works or user data, not derivative OFF databases, provided they are not built to extract OFF data. They need only attribution. Simplest compliant path: always attribute, keep OFF-derived data in clearly separated tables, and publish the OFF-derivative transformation scripts (or a dump) under ODbL.

### Cited Findings (ODbL 1.0, verbatim from [opendatacommons.org](https://opendatacommons.org/licenses/odbl/1-0/))

- "Collective Database" means "this Database in unmodified form as part of a collection of independent databases in themselves that together are assembled into a collective whole. A work that constitutes a Collective Database will not be considered a Derivative Database."
- "Derivative Database" means "a database based upon the Database, and includes any translation, adaptation, arrangement, modification, or any other alteration of the Database or of a Substantial part of the Contents. This includes, but is not limited to, Extracting or Re-utilising the whole or a Substantial part of the Contents in a new Database."
- "Produced Work" is "a work (such as an image, audiovisual material, text, or sounds) resulting from using the whole or a Substantial part of the Contents (via a search or other query) from this Database, a Derivative Database, or this Database as part of a Collective Database."
- "Publicly" means "to Persons other than You or under Your control by either more than 50% ownership or by the power to direct their activities".
- "Convey… does not include interaction with a user through a computer network, or creating and Using a Produced Work, where no transfer of a copy of the Database or a Derivative Database occurs."
- "Substantial": "The repeated and systematic Extraction or Re-utilisation of insubstantial parts of the Contents may amount to the Extraction or Re-utilisation of a Substantial part".
- §4.3: "if you Publicly Use a Produced Work, You must include a notice… aware that Content was obtained from the Database… and that it is available under this License." The example notice is "Contains information from DATABASE NAME, which is made available here under the Open Database License (ODbL)."
- §4.4a: "Any Derivative Database that You Publicly Use must be only under the terms of: i. This License; ii. A later version…; or iii. A compatible license."
- §4.4c: "A Derivative Database is Publicly Used and so must comply with Section 4.4. if a Produced Work created from the Derivative Database is Publicly Used."
- §4.5: "a. …You are not required to license Collective Databases under this License if You incorporate this Database or a Derivative Database in the collection, but this License still applies to this Database or a Derivative Database as a part of the Collective Database; b. Using this Database… to create a Produced Work does not create a Derivative Database for purposes of Section 4.4; and c. Use of a Derivative Database internally within an organisation is not to the public".
- §4.6: "If You Publicly Use a Derivative Database or a Produced Work from a Derivative Database, You must also offer to recipients… a copy in a machine readable form of: a. The entire Derivative Database; or b. A file containing all of the alterations made to the Database or the method of making the alterations to the Database (such as an algorithm), including any additional Contents… free of charge if distributed over the internet."
- §4.7a: you may not impose "any terms or any technological measures" that restrict the licence. Per the page summary, 4.7b allows parallel distribution of an unrestricted copy.

**OSMF guidelines (by analogy; non-binding for OFF)**

- _Produced Work guideline_ (endorsed by the OSMF board 2014-06-06): "If the published result of your project is intended for the extraction of the original data, then it is a database and not a Produced Work. Otherwise it is a Produced Work." Also: "If you publish a produced work, the underlying database has to be published as well… according to section 4.6", which applies where the underlying database is a derivative. — [OSMF](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Produced_Work_-_Guideline)
- _Collective Database guideline_ (endorsed 2016-06-17): datasets combined in one database form a Collective Database "so long as the data used for a particular data type is either all OSM or all non-OSM within the same regional cut", and the condition "the non-OSM and OSM datasets do not reference each other". — [OSMF](https://osmfoundation.org/wiki/Licence/Community_Guidelines/Collective_Database_Guideline_Guideline)

**OFF's own terms**

- Database: ODbL. Individual contents: Database Contents License. Images: CC BY-SA. Re-users must "mention the licence and to attribute the authorship to Open Food Facts with a link to https://openfoodfacts.org" (or the product page). "Derivative works must be shared under the same conditions." Third-party trademark and packaging-image rights may apply. — [OFF terms of use](https://world.openfoodfacts.org/terms-of-use)
- OFF data page:
  - Attribution format: "Contains data from Open Food Facts, available under the Open Database License".
  - "If you publicly use any adapted version of this database, or works produced from an adapted database, you must also offer that adapted database under the ODbL and share your modifications back."
  - Apps allowing user contributions must send data back via the API.
  - API rule: "one call = one real scan". Scraping via the API "will very likely be blocked"; use the daily exports instead. Send identifying headers.
  - UI attribution should appear "on product pages, search screens, and in the 'About' or 'Settings' sections" with links to OFF and the ODbL.
  - Source: [OFF data](https://world.openfoodfacts.org/data)

### Inferences

- **The unmodified mirror next to FDC is a Collective Database** (§4.5a), so FDC data, app code and user data are not subject to ODbL. Two cautions:
  1. A mirror that is filtered (for example, only PT/EU products, dropped columns, normalised units) is arguably "modification", which makes it a Derivative Database. Assume derivative status is the conservative default.
  2. If OFF and FDC rows are cross-linked (a match table) or merged into one "foods" table, the OSMF-analogous view is that the merged table is derivative.
- **Hosted service.** Displaying OFF data to tenants is Public Use. ODbL has no SaaS carve-out comparable to "Convey"; §4.4c and §4.6 apply to Produced Works from a Derivative Database when Publicly Used. The obligation is to offer **only the OFF-derived database** (or a diff or algorithm), not AGPL app code (that falls under AGPL §13 separately) and not user data.
- **User nutrition logs** (user X ate 2 servings of product barcode Y, with computed macros) are user-generated records. Shown only to that user and their organisation, they are Produced Works or independent data. They are not intended to extract OFF data, and individual entries are insubstantial. Risk: a feature that exports or shares many OFF records (for example "export my food database", or public shared recipe libraries embedding OFF nutrient rows) could amount to systematic re-utilisation. Treat such exports as ODbL output with notice.
- **User corrections or new products** added to the OFF table make it derivative. Push them back to OFF via the API, as the OFF data page asks, and keep them in a separate overlay table.
- **Concrete rules to adopt:**
  1. Keep `off_products` (OFF-sourced, with OFF code, last-modified date and import batch) separate from `fdc_foods` and from user tables. Never merge them into a single canonical foods table. Use a view or union at query time, with a `source` column.
  2. Show the attribution "Contains data from Open Food Facts, available under the Open Database License" (both linked) on every product view and search result that uses OFF, and in About/Settings and the export footers.
  3. Publish the OFF import and transform scripts (already AGPL in the repo) and state in `DATA-LICENSES.md` that the OFF-derived tables are ODbL. Offer a downloadable dump or "regenerate from OFF dump with this script", which satisfies the §4.6b "method of making the alterations".
  4. Product images are CC BY-SA. Either do not store them (link or hotlink with credit) or store them with per-image attribution.
  5. Use the nightly dumps for bulk data. Make API calls only for real user scans, and send a User-Agent identifying openhealth with contact details.
  6. User-contributed product data goes to an overlay table and is optionally pushed to OFF. Never put it under terms that conflict with ODbL (§4.7).
  7. Tenant exports of food logs carry the ODbL notice if they include OFF-derived nutrient values.
- **Residual risk:** low. ODbL compliance here is cheap. The main failure mode is missing attribution or a proprietary merged table.

### Gaps

- I did not find OFF-specific guidance (separate from OSMF's) on Collective vs Derivative status. I did not fetch the OFF wiki pages on ODbL FAQ or reuse.
- The DbCL text (for individual contents) was not fetched.

## 5. Recipe URL import

### Takeaway

A user-initiated import of one recipe into a private account, storing ingredients, quantities, and steps rewritten or kept as the user's draft, plus the source URL and no images, is low-risk. In the US, ingredient lists and simple directions are not copyrightable. In the EU, the main exposure is site ToS (contract) and the database sui generis right, and a one-off, user-triggered fetch of a single page extracts an insubstantial part. Do not bulk-crawl, do not copy photos or long narrative text, and do not share imported recipes publicly by default.

### Cited Findings

- Copyright Office Circular 33: "A recipe is a statement of the ingredients and procedure required for making a dish of food. A mere listing of ingredients or contents, or a simple set of directions, is uncopyrightable… In contrast, a recipe that creatively explains or depicts how or why to perform a particular activity may be copyrightable. A registration for a recipe may cover the written description or explanation of a process… as well as any photographs or illustrations… However, the registration will not cover the list of ingredients…, the underlying process for making the dish, or the resulting dish itself." — [copyright.gov Circular 33](https://www.copyright.gov/circs/circ33.pdf) (verified from the PDF text. A WebFetch summary misquoted this as "Directions… are not protected"; the actual wording is "a simple set of directions".)
- _Publications Int'l, Ltd. v. Meredith Corp._, 88 F.3d 473 (7th Cir. 1996): the lists of ingredients "lack the requisite element of originality and are without the scope of copyright", and the court vacated the injunction because the recipes at issue were not protectable. Copyright protected only the compilation and presentation, not the individual recipes. — [CourtListener](https://www.courtlistener.com/opinion/721354/publications-international-limited-plaintiffcounterdefendant-appellant/); [FindLaw](https://caselaw.findlaw.com/court/us-7th-circuit/1278644.html) (quotes taken via search snippets; the full opinion did not load)
- Portugal, CDADC Art. 1(2): "As ideias, os processos, os sistemas, os métodos operacionais, os conceitos, os princípios ou as descobertas não são, por si só e enquanto tais, protegidos" (ideas, processes, systems, operating methods, concepts, principles and discoveries are not protected as such). — [CDADC (GDA consolidated PDF)](https://www.gda.pt/wp-content/uploads/2020/04/codigododireitodeautorcdadclei162008.pdf)
- EU law, background, not fetched this session **[unverified wording]**:
  - Database Directive 96/9/EC Art. 8(1): a lawful user may extract or re-utilise insubstantial parts "for any purposes whatsoever".
  - Art. 7(5) bars repeated and systematic extraction of insubstantial parts that conflicts with normal exploitation. — [EUR-Lex 31996L0009](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:31996L0009)
  - InfoSoc 2001/29/EC Art. 5(2)(b): private copying by a natural person, non-commercial. — [EUR-Lex 32001L0029](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32001L0029)
  - DSM 2019/790 Art. 4: TDM exception, subject to rightsholder opt-out "in an appropriate manner, such as machine-readable means". — [EUR-Lex 32019L0790](https://eur-lex.europa.eu/eli/dir/2019/790/oj). Single-recipe import is not really TDM, so Art. 4 adds little; honour robots.txt and opt-outs anyway.
  - CJEU C-30/14 _Ryanair v PR Aviation_: for databases protected by neither copyright nor sui generis right, site terms can contractually restrict use.
  - CJEU C-762/19 _CV-Online Latvia v Melons_: sui generis infringement requires a risk to the maker's investment.

### Inferences

- **Lawfulness.** The import keeps facts and functional content (ingredients, quantities, simple steps) in a private account, triggered by the user who visited the page. That fits the US non-copyrightability of recipes and the EU lawful-user and insubstantial-part rules. A hosted service acting on the user's instruction is, conservatively, a tool for the user and not a publisher.
- **Rules to adopt:**
  1. Fetch only when the user submits a URL. No background crawling, prefetching or "discover recipes" scraping.
  2. Parse schema.org `Recipe` JSON-LD when present. Store `recipeIngredient` (parsed into quantity, unit and item), `recipeInstructions` as an editable user draft, servings and times, plus `source_url`, the source site name, an author credit if present, and `imported_at`.
  3. Do not store images, headnotes, stories or reviews. Show a "View original" link instead.
  4. Mark imported recipes private to the user's organisation. Any public or shared publishing of an imported recipe requires the user to rewrite the steps and keep attribution, and is off by default.
  5. Rate-limit per user and per domain (for example ≤10 imports/min/user and a global per-domain cap). Send an honest User-Agent and respect robots.txt `Disallow` for the fetcher's UA, as an opt-out courtesy.
  6. SSRF hardening is mandatory:
     - Allow only http/https.
     - Resolve DNS, block private, loopback, link-local and metadata ranges (169.254.169.254, ::1, fc00::/7, 10/8, 172.16/12, 192.168/16, 127/8), and re-check after redirects.
     - Allow at most 3 redirects, a timeout of about 10 s, and a response cap of about 2 MB.
     - Accept only text/html.
     - Do not forward cookies or auth.
     - Run the fetch from an isolated egress.
  7. Do not log page bodies.
  8. Provide a takedown contact. On a rightsholder request, delete the imported text and keep only the link.
- **Residual risk:** low. The main exposure is a site's ToS forbidding automated access (contract, under Ryanair). Rules 1, 5 and 8 address it.

### Gaps

- The EU directive texts and CJEU cases were not fetched this session, so their wording is unverified.
- No case law was found on "user-initiated import into a private SaaS account" specifically.

## 6. Guideline facts (USPSTF, NICE, DGS, WHO)

### Takeaway

Storing short factual fields (title, grade, population and age/sex criteria, interval, link) as your own structured paraphrase is defensible under every source's regime, because facts and procedures are not protected (CDADC Art. 1(2); US idea/expression). Copying text is a different matter:

- **USPSTF:** text reproduction is allowed only unmodified and not in a "profit-making venture" without AHRQ permission.
- **NICE:** content (including via API) needs a paid licence for use outside the UK. NICE bans scraping and AI training.
- **WHO:** CC BY-NC-SA 3.0 IGO, so non-commercial only.
- **DGS:** no explicit reuse terms were found.

Decision: store your own short paraphrased fields plus a deep link and a citation. Never copy recommendation text, never scrape NICE, never imply endorsement.

### Cited Findings

- **USPSTF copyright notice.**
  - AHRQ permits the public to "reproduce, redistribute, publicly display, and incorporate USPSTF work into other materials" "without any changes to the work of portions thereof, except as permitted as fair use".
  - The work may not be "reproduced, reprinted, or redistributed for a fee", "sold for profit or incorporated into a profit-making venture without the express written permission of AHRQ".
  - "AHRQ and the U.S. Department of Health and Human Services cannot endorse, or appear to endorse, derivative or excerpted materials".
  - "When parts of a recommendation statement are used or quoted, the USPSTF Web page should be cited as the source."
  - Source: [USPSTF copyright notice](https://www.uspreventiveservicestaskforce.org/uspstf/index.php/recommendation-topics/copyright-notice)
- **NICE.**
  - "The use [of] our content outside the UK, except for personal research and study purposes, requires written permission and is subject to a fee and licensing agreement." This covers use "as part of a service, publication, application or product available outside the UK".
  - API use, "including any use of AI on our content", requires an API application.
  - "We do not licence or allow our content to be used to train AI models. Web scraping of our content from the NICE website is not permitted."
  - Source: [NICE international use](https://www.nice.org.uk/reusing-our-content/use-of-our-content-internationally)
- The NICE UK Open Content Licence (free) covers UK settings only. International fees include a £550 test licence and a £60,000 annual worldwide service licence. — [NICE reuse pages via search](https://www.nice.org.uk/re-using-our-content); [NICE UK open content licence](https://www.nice.org.uk/reusing-our-content/nice-uk-open-content-licence)
- **WHO.** Publications are CC BY-NC-SA 3.0 IGO, with permission needed for other uses. "WHO publications cannot be used to promote or endorse products, services or any specific organization. WHO logo cannot be used without written authorization from WHO." The suggested citation format is "[Title]. [Place]: World Health Organization; [Year]. Licence: CC BY-NC-SA 3.0 IGO." — [WHO copyright](https://www.who.int/about/policies/publishing/copyright)
- **Portugal, CDADC.**
  - Art. 1(2): ideas, processes, methods and concepts are not protected as such.
  - Art. 7(1) excludes news items, petitions to authorities, texts and speeches before collegial bodies, and political speeches.
  - Art. 8(1) says compiled or annotated official texts referred to in Art. 3(1)(c) "não beneficiam de protecção" (are not protected).
  - Whether DGS _Normas_ count as unprotected official texts was not established.
  - Source: [CDADC PDF](https://www.gda.pt/wp-content/uploads/2020/04/codigododireitodeautorcdadclei162008.pdf)

### Inferences

- **Recommended data rule:**
  - Store per guideline: `source_org`, `source_id/version`, `title` (a short factual title is acceptable to reproduce; titles generally lack protection, but keep it short), `grade` (A/B/C/D/I is a factual label), `population` (structured: sex, age_min, age_max, risk flags), `interval`, `effective_date`, `canonical_url`, `retrieved_at`, `content_hash`.
  - Write all criteria as your own structured data. Do not store rationale or clinical-consideration text.
- **Per source:**
  - **USPSTF:** structured facts plus a link and the citation "Source: USPSTF, [topic], [date], [URL]". Add the disclaimer "Not endorsed by AHRQ/HHS/USPSTF." The hosted service is arguably a "profit-making venture", so never copy statement text. The US-government-work status of USPSTF output is contested by AHRQ's own notice; treat it as licensed, not public domain.
  - **NICE:** for a product available outside the UK, do not ingest NICE content, use its API, or scrape. At most, store a hand-entered factual summary of a few fields plus a link. More conservatively, link only to NICE (for UK users) without any stored NICE-derived fields, because NICE asserts licensing over "use of our content" in products.
  - **WHO:** the hosted service may be commercial, so do not reproduce WHO text or tables. Store facts and a link only, and never use the logo.
  - **DGS:** factual fields plus a link and the citation "Norma DGS n.º X/AAAA". No reproduction of the Norma text until DGS terms are confirmed.
  - **All sources:** add a UI line saying the source organisations do not endorse openhealth. Link to the canonical page, not a mirror.
- **Residual risk:** low for USPSTF, WHO and DGS facts with links. Medium for NICE, whose terms reach broadly to any "use of our content" outside the UK, so link only or seek a licence before storing NICE-derived fields.

### Gaps

- I found no dgs.pt terms of use or copyright notice; the search returned only general CDADC material. Manual step: check the footer of www.dgs.pt for "Termos e condições"/"Direitos de autor" and email the DGS if storing more than facts is needed.
- I did not fetch the USPSTF Prevention TaskForce API terms.
- I could not fetch the NICE UK Open Content Licence text (HTTP 403 and 404); its scope comes from search snippets.
- No case law was found on whether a guideline's grade or interval is protected as a database extract. Small factual extractions fall below the "substantial" threshold under Directive 96/9 Art. 7 **[unverified wording]**.
