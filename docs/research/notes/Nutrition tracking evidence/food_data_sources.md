# Food Composition Databases, Barcode Lookup, Licensing and Quality (for OpenValens)

Context: OpenValens is an open-source (AGPLv3), self-hostable nutrition tracker with a planned maintainer-run hosted service; users in US, UK, EU (incl. Portugal). All sources retrieved 2026-10-02 unless noted. Items marked **[COUNSEL]** need legal review before shipping. Session note: the web-search budget ran out partway through, so some sub-questions (Edamam/Nutritionix full ToS, Braakhuis 2017, EuroFIR terms, per-country Open Food Facts counts) are listed as gaps, not answered from memory.

## 1. USDA FoodData Central (FDC): datasets, license, API, bulk, cadence

### Takeaway

FDC is public domain/CC0, can be bundled, cached and redistributed in an AGPL app with no share-alike constraint. Use the bulk downloads as the backbone (Foundation + SR Legacy + FNDDS for generic foods, Branded for US barcodes), and use the API (1,000 req/h/IP) only for top-ups. Branded Foods is the only US source here that is barcode-keyed and license-clean.

### Cited Findings

- License: "USDA FoodData Central data are in the public domain and they are not copyrighted. They are published under CC0 1.0 Universal (CC0 1.0)." — [FDC API Guide](https://fdc.nal.usda.gov/api-guide/) (retrieved 2026-10-02)
- Attribution is requested, not required: users should "list FoodData Central as the source of the data, and when possible, notify us of the product that uses the data"; a suggested citation is provided. — [FDC API Guide](https://fdc.nal.usda.gov/api-guide/)
- API requires a data.gov API key on every request. Default limit is 1,000 requests/hour/IP. DEMO_KEY is limited to 30 requests/IP/hour and 50/IP/day. Key holders must keep the key private. — [FDC API Guide](https://fdc.nal.usda.gov/api-guide/)
- Data types exposed: Foundation Foods, SR Legacy, Survey Foods (FNDDS), Experimental Foods, Branded Foods. — [FDC API Guide](https://fdc.nal.usda.gov/api-guide/)
- Latest bulk releases (as listed on the download page): Foundation Foods April 2026 (JSON 459K zipped / CSV 3.7M zipped); SR Legacy April 2018, the "final release" that "will not be updated"; FNDDS 2021–2023, released October 2024; Branded Foods April 2026 (JSON 195M zipped / 3.1G unzipped; CSV 428M zipped / 2.9G unzipped). — [FDC Download Datasets](https://fdc.nal.usda.gov/download-datasets/)
- FNDDS "is updated every two years, in conjunction with the two-year cycles of" NHANES. — [FDC Download Datasets](https://fdc.nal.usda.gov/download-datasets/)

### Inferences

- Because the data is CC0, OpenValens can ship a pre-built FDC-derived seed DB in the repo or as a release artifact, merge it with other sources, and expose it through the hosted service with no license tension against AGPL. An attribution line ("Source: USDA FoodData Central") is courteous and recommended.
- With an API key, a self-hosted instance stays well under 1,000 req/h. The hosted service should still sync from bulk files rather than proxying user lookups to the API, because the limit is per IP and the shared service would hit it.
- Release dates on the download page suggest Foundation/Branded are refreshed about twice a year (April and, historically, October). Treat this as an inference, because the page does not state a cadence for Branded or Foundation.
- Nutrient coverage differs by dataset. Foundation/SR Legacy carry broad micronutrient panels. Branded Foods mostly reflects US Nutrition Facts label nutrients, so expect sparse micronutrients for branded items. This comes from background knowledge and was not re-verified this session.

### Gaps

- Exact Branded Foods release cadence and record count were not stated on the pages fetched.
- Nutrient counts per dataset (e.g. "~150 nutrients in SR Legacy") were not verified this session.
- Whether Branded Foods data (manufacturer-submitted via GS1/1WorldSync/Label Insight) carries any third-party restrictions despite the CC0 statement. The CC0 statement covers all FDC data on its face, but if the hosted service redistributes Branded images or label text, confirm with counsel. **[COUNSEL]** (low risk)

## 2. Open Food Facts (OFF): ODbL/DbCL/CC BY-SA obligations, API rules, quality, coverage

### Takeaway

OFF is the only open, global, barcode-keyed source and the obvious choice for EU/UK/PT barcodes. Its ODbL share-alike is the main legal design constraint. Keep OFF data in a separate, unmodified-or-separately-published table ("Collective Database" posture) and show attribution. If OpenValens publicly serves a database it modified or merged from OFF, it must offer that database (or a diff) under ODbL. Bulk dumps are nightly. The live API is strictly rate-limited and needs a custom User-Agent, so the hosted service should mirror dumps rather than proxy the API.

### Cited Findings

**Licenses (OFF terms)**

- "The Open Food Facts database is available under the Open Database License"; "Individual contents of the database are available under the Database Contents License"; "Products images are available under the Creative Commons Attribution ShareAlike licence" (CC BY-SA 3.0). — [OFF Terms of Use](https://world.openfoodfacts.org/terms-of-use)
- Reusers must "mention the licence and … attribute the authorship to Open Food Facts with a link to https://openfoodfacts.org" or the product pages. "Derivative works must be shared under the same conditions." — [OFF Terms of Use](https://world.openfoodfacts.org/terms-of-use)
- OFF licenses cover only OFF's rights. "Other rights of third parties may apply, such as: copyright for the product design … trademark rights etc." (relevant to packaging images). — [OFF Terms of Use](https://world.openfoodfacts.org/terms-of-use)
- OFF disclaims accuracy and completeness. Data is "provided only for indicative information" and is not suitable for medical use. — [OFF Terms of Use](https://world.openfoodfacts.org/terms-of-use)
- The data page gives this attribution text: "Contains data from Open Food Facts, available under the Open Database License". It asks reusers to contribute modifications back under ODbL and to include prominent UI attribution with clickable links. — [OFF Data page](https://world.openfoodfacts.org/data)

**ODbL mechanics (license text)**

- _Derivative Database_: "a database based upon the Database", including adaptations/modifications and extracting or re-utilising a substantial part of the contents into a new database. — [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- _Collective Database_: the Database "in unmodified form as part of a collection of independent databases". This is **not** a Derivative Database. — [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- _Produced Work_: "a work (such as an image, audiovisual material, text, or sounds) resulting from using the whole or a Substantial part of the Contents". — [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- _Publicly_: available to persons other than you or entities under your control (>50% ownership or power to direct). — [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- §4.4: a publicly used Derivative Database must be under ODbL, a later version, or a compatible license. §4.5: share-alike does **not** apply to Collective Databases, to Produced Works, or to Derivative Databases used only internally. §4.3: publicly used Produced Works need a notice that content came from the Database, plus an ODbL reference. §4.6: publicly used Derivative Databases must offer recipients the whole derivative database or "a file containing all of the alterations made" in machine-readable form. — [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- The ODC FAQ illustrates the split this way. A derivative database is like "adding locations of post offices to the original database"; a produced work is like "using a geospatial database to generate a map". It also notes "most compliance is driven by the community not by the courts". The FAQ gives no specific guidance on merging databases. — [ODC Licenses FAQ](https://opendatacommons.org/faq/licenses/)

**API rules**

- Rate limits: 15 req/min/IP for product reads (`GET /api/v*/product`); 10 req/min/IP for search (`/api/v*/search`, `/cgi/search.pl`). Search-as-you-type is discouraged. Write queries are not limited. Going over can lead to IP bans (appeal via reuse@openfoodfacts.org). Infrastructure-wide protection returns HTTP 503. — [OFF API docs](https://openfoodfacts.github.io/openfoodfacts-server/api/)
- A custom User-Agent `AppName/Version (ContactEmail)` is required on all requests. Reads need no auth. Writes need account credentials (session cookie preferred, max 10 sessions/user) plus `app_name`, `app_version`, `app_uuid` for contribution tracking. — [OFF API docs](https://openfoodfacts.github.io/openfoodfacts-server/api/)
- "If you need to fetch more than a few hundred products, we ask you to download the data as a CSV or JSONL file." For substantial traffic OFF "strongly encourage[s] you to host a local instance of Product Opener (or another custom API backend), and use the daily exports". — [OFF API docs](https://openfoodfacts.github.io/openfoodfacts-server/api/)
- Dumps: MongoDB dump (plus daily deltas over a 14-day rolling window, with SHA256/MD5), JSONL (gzip), Parquet on Hugging Face, CSV (~0.9 GB compressed / ~9 GB uncompressed, tab-separated), and experimental RDF that is no longer maintained. All are generated nightly. — [OFF Data page](https://world.openfoodfacts.org/data)
- During this session the OFF wiki ODbL page returned an access-denied bot challenge, and the country facet page returned HTTP 503. Both were unavailable. — [OFF wiki](https://wiki.openfoodfacts.org/ODBL_License), [OFF country facets](https://world.openfoodfacts.org/facets/countries)

**Quality/coverage**

- The FoodRepo paper (peer-reviewed, PMC) notes that curators of crowd/producer-sourced barcode repositories "cannot ensure the validity of the data reported by the producers on the nutrition facts labels". — [FoodRepo, PMC6040205](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6040205/)
- A secondary, non-authoritative tutorial site says OFF passed 3.5 million products by late 2025, with the largest coverage in France, Germany, the UK and Spain and growing US coverage. It describes coverage as "excellent in France and Western Europe, good in North America, patchier elsewhere", with any field possibly missing. — [selfhostednutrition.org tutorial](https://selfhostednutrition.org/api/open-food-facts-api-tutorial/) (secondary source; treat as indicative only)

### Inferences

- **Recommended architecture (needs [COUNSEL] confirmation):**
  1. Import OFF dumps into a dedicated `off_products` table that mirrors OFF fields and is never edited in place. Keep the OFF code, last-modified timestamp and dump hash for provenance.
  2. Keep FDC, CoFID, Ciqual and the user's private custom foods in separate tables, and resolve lookups at query time. This fits the "Collective Database" carve-out (§4.5) as closely as possible, so ODbL does not reach OpenValens's other data.
  3. If OpenValens corrects or enriches OFF records (unit normalization, nutrient fixes, dedupe), treat the result as a Derivative Database. On the hosted service (a "public use"), it then has to be offered under ODbL, with the full DB or a machine-readable diff. Simplest compliant path: push fixes back to OFF via the write API so the local mirror needs no divergent changes.
  4. Showing a user a nutrition panel or a daily total is most plausibly a Produced Work and only needs the attribution notice (§4.3), e.g. "Contains data from Open Food Facts (ODbL)" with a link, next to OFF-sourced items and in About/Settings.
- AGPL vs ODbL: they govern different things (code vs database), so bundling OFF data does not relicense the code, and AGPL does not conflict with ODbL. Shipping an OFF-derived SQLite/Postgres seed in the repo makes that file an ODbL-licensed component, so it needs a clear LICENSE note. **[COUNSEL]**
- Images are CC BY-SA 3.0 plus third-party packaging copyright/trademark. Hotlinking or caching OFF images with per-image attribution is the low-risk option. Avoid re-hosting images as part of the hosted product's own branding. **[COUNSEL]**
- Self-hosters who each hit the live API at 15 req/min/IP will mostly be fine for personal use. The hosted service must not proxy user scans through the live API from one IP. It should use the nightly dumps plus deltas.
- Per-user private custom foods do not trigger share-alike while kept private, but only if they are not built by extracting a substantial part of OFF. A user editing a single OFF entry into a private copy is probably insubstantial. **[COUNSEL]**

### Gaps

- Per-country product counts and nutrient completeness for Portugal, UK, US and EU from a primary source: the OFF facets page returned 503 and the search budget was exhausted. Recommend running a DuckDB query on the JSONL/Parquet dump: count by `countries_tags`, plus the share with `nutriments.energy-kcal_100g` and `proteins_100g`/`fat_100g`/`carbohydrates_100g` present.
- No peer-reviewed error-rate study of OFF nutrient values was found this session.
- OFF's own ODbL FAQ wording on "local caching" and "merging" was unavailable (wiki blocked).

## 3. European/UK/Portuguese composition tables: CoFID, INSA/PortFIR, Ciqual, EuroFIR

### Takeaway

Ciqual (France, Etalab Licence Ouverte) and UK CoFID (Crown copyright, Open Government Licence v3.0 per gov.uk) are open-licensed and compatible with redistribution in an AGPL app, with attribution. Portugal's INSA table is free to download but the PortFIR site says "Todos os direitos reservados" and publishes no reuse license. Do **not** bundle or redistribute it without written permission from INSA. EuroFIR is not an open source.

### Cited Findings

- **UK CoFID:** the gov.uk publication page states "All content is available under the Open Government Licence v3.0, except where otherwise stated", Crown copyright. Latest update 19 March 2021, adding 2020 pork analyses and corrections (vitamin C in watercress, iodine in soya yogurt, vitamin E/sugars/biotin in sweet potato). Some 2008 foods not reviewed in 2015/2019/2021 are published separately as "old foods". Distributed as an Excel file (4.42 MB) plus a 37-page user guide. — [gov.uk CoFID](https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid)
- **Ciqual (ANSES):** the data.gouv.fr dataset is under Licence Ouverte / Open Licence (Etalab). The 2020 version has 3,484 foods. The page notes the dataset "is now made available via the recherche.data.gouv platform, in an updated version that supersedes this one". — [data.gouv.fr Ciqual](https://www.data.gouv.fr/fr/datasets/table-de-composition-nutritionnelle-des-aliments-ciqual/)
- **Portugal INSA TCA:** version 6.0 was released 7 June 2023 with 1,330 foods and 44 components, publishing iodine and selenium for the first time. Excel download via PortFIR. Free access, with annual updates since 2017. — [INSA news](https://www.insa.min-saude.pt/disponivel-nova-versao-da-tabela-de-composicao-de-alimentos/)
- The PortFIR site footer reads "© 2026 Plataforma Portuguesa de Informação Alimentar. Todos os direitos reservados." No explicit reuse license or citation terms were found. The most recent downloadable file is dated November 2025. Contact: tabela.alimentos@insa.min-saude.pt. — [PortFIR](https://portfir.insa.min-saude.pt/)
- PortFIR is modelled on the EuroFIR network. — [PortFIR about (test host)](https://jspapp.test.insa.foodcase-services.com/insa/about)

### Inferences

- OGL v3.0 and Etalab Licence Ouverte 2.0 are permissive attribution licenses, and both are designed to be compatible with CC BY / ODC-BY. They can be bundled into an AGPL app and served from the hosted service with an attribution line. Background knowledge: Etalab 2.0 explicitly lists compatibility with OGL, CC BY 2.0+ and ODC-BY.
- The CoFID "OGL except where otherwise stated" wording is the gov.uk site-wide notice. Check the CoFID Excel/user guide for any "otherwise stated" carve-out before bundling. **[COUNSEL]** (low risk) The printed _McCance and Widdowson's_ book is published separately and is not the CoFID dataset.
- Portugal: "all rights reserved" plus free download means personal use is fine, but redistribution in a public repo or hosted service is not licensed. Options: (a) email INSA for a written license; (b) give self-hosters an import script that pulls the Excel from PortFIR at install time (redistributes no data, but terms of use for automated download still apply); (c) rely on OFF for PT branded products plus Ciqual/CoFID for generic foods. **[COUNSEL]** Under EU Database Directive sui generis rights, INSA may hold database rights even without a stated license.
- For a Portuguese user, generic foods from Ciqual/CoFID are a reasonable proxy, but traditional PT dishes (bacalhau preparations, caldo verde, etc.) are best covered by INSA, which strengthens the case for (a).

### Gaps

- EuroFIR FoodEXplorer/AISBL licensing: not fetched this session. Background knowledge says it is a paid membership/license service, not open data, so it should be ruled out for bundling. Verify.
- Ciqual's current version on recherche.data.gouv.fr (likely 2025) and whether its license is still Etalab 2.0 were not fetched.
- CoFID food/nutrient counts were not on the fetched page.

## 4. Commercial sources (Nutritionix, Edamam, FatSecret, Spoonacular)

### Takeaway

All four forbid or tightly limit persistent caching and redistribution, and require API keys bound to a contract. That conflicts with a self-hostable AGPL app (every self-hoster would need their own commercial agreement) and with building an OpenValens database. Rule them out as core sources. At most, add an optional, off-by-default "bring your own key" adapter that never persists their nutrient data.

### Cited Findings

- **FatSecret:** per the Developer Terms, "you may not cache any user data for more than 24 hours" except fields explicitly "storable indefinitely", which are only IDs (food_id, serving_id, recipe_id, food_entry_id, etc.) and auth tokens. — [fatsecret Storable Data guide](https://platform.fatsecret.com/docs/guides/storable-data) (as summarized in search results; page not fetched directly)
- FatSecret requires attribution (badge or snippet) in three places: inside the app where content is shown, on the website, and in App Store / Google Play listings. — [fatsecret Attribution Policy](https://platform.fatsecret.com/attribution)
- **Spoonacular:** caching is allowed only "With prior written permission … (for a maximum of 1 hour)". Recipe IDs, titles and image URLs may be stored indefinitely. The terms prohibit storing nutrition data and other content types, building competing platforms, scraping, and reselling. Data must be deleted if access ends. Backlinks are required on free/academic plans. — [spoonacular Terms](https://spoonacular.com/food-api/terms)
- **Nutritionix:** pricing tiers list "Caching Allowed" and attribution as plan-dependent features. Nutritionix has ended its public free tier for hobbyists and targets commercial/enterprise customers. It is now part of Syndigo. — [Nutritionix API](https://www.nutritionix.com/api); [Syndigo Nutritionix docs](https://docx.riversand.com/developers/docs/nutritionix-api-guide) (search-result summary; full ToS not fetched)

### Inferences

- No commercial source permits the "download once, serve to everyone, let anyone self-host" model that OpenValens needs. Their key-based terms also make it impossible to ship working defaults in an open-source repo.
- If a BYO-key adapter is offered, it must store only permitted IDs and re-fetch nutrients on display, which complicates offline and longitudinal records. That is a strong reason to keep these out of the MVP.

### Gaps

- Edamam terms: the developer terms page returned empty content and searches were exhausted. Background knowledge says Edamam requires "Powered by Edamam" attribution and restricts caching, but this was not verified.
- The full Nutritionix Terms of Use text was not fetched.

## 5. Accuracy studies of nutrition-app databases (crowd-sourced vs curated)

### Takeaway

Crowd-sourced databases (MyFitnessPal) are acceptable for energy and macronutrients, with errors of a few percent to about 15%, but unreliable for sodium and cholesterol, and they need outlier cleaning. OpenValens should rank curated or label-derived sources above user entries, flag incomplete entries, and run plausibility checks.

### Cited Findings

- Evenepoel et al. (JMIR 2020) compared MyFitnessPal against the Belgian Nubel database: 50 participants, two 4-day records one month apart, 2,826 food items. A cleaning algorithm removed 79 items (2.8%) using per-portion caps (1,500 kcal, 95 g carbs, 92 g fat, 52 g protein, 22 g fibre, 70 g sugar, 600 mg cholesterol, 3,600 mg sodium). — [Evenepoel 2020, PMC7641788](https://pmc.ncbi.nlm.nih.gov/articles/PMC7641788/); [PubMed 33084583](https://pubmed.ncbi.nlm.nih.gov/33084583/)
- After cleaning, correlations with Nubel were energy r=0.96, carbohydrates 0.90, fat 0.90, protein 0.90, fibre 0.80, sugar 0.79, but cholesterol ρ=0.51 and sodium ρ=0.53. MFP underestimated protein by 7.8%, carbohydrates by 6.4% and fat by 1.7%, and overestimated energy by 1.3%. Sodium was underestimated by about 1,345 mg/day and cholesterol by about 187 mg/day. Using MFP would need 10–65% larger samples to keep statistical power. Conclusion: accurate "for total energy intake, macronutrients, sugar, and fiber, but not for cholesterol and sodium". — [Evenepoel 2020, PMC7641788](https://pmc.ncbi.nlm.nih.gov/articles/PMC7641788/)
- The paper calls MFP "partially user-based" and "inherently prone to errors", and notes some entries lack full macronutrient data, which skews calculations. — [Evenepoel 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7641788/)
- Prior studies cited by Evenepoel:
  - Teixeira et al. 2018 (Brazil): MFP underestimated energy by 0.7%, fat 16.8%, protein 11.9%, carbohydrates 10.8%.
  - Griffiths et al. 2018: vs NDSR, MFP underestimated energy 4.1%, fat 14.1%, protein 8.0%.
  - Chen et al. 2019: naturalistic use "fails to provide accurate measurements".
    — [Evenepoel 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7641788/)
- A 2020 J Acad Nutr Diet paper, "Assessment of the Accuracy of Nutrient Intake Calculations from Popular Nutrition Tracking Apps", exists, but the full text and abstract returned HTTP 403. — [JAND](<https://www.jandonline.org/article/S2212-2672(20)31238-7/abstract>)
- A 2025 J Hum Nutr Diet study (Morello et al.) compared MyFitnessPal and Cronometer reliability and validity in Canadian endurance athletes. The full text returned 403, so findings are not extracted. — [Morello 2025, JHND](https://onlinelibrary.wiley.com/doi/full/10.1111/jhn.70148)

### Inferences

- Product rules suggested by the evidence:
  1. Show source and confidence per food (FDC/CoFID/Ciqual = curated; OFF = label-derived, crowd-entered; user = unverified).
  2. Apply Evenepoel-style per-portion plausibility caps and an energy-from-macros (Atwater) check, e.g. flag if |kcal − (4P + 4C + 9F + 2fibre)| is above roughly 15–20%.
  3. Don't report sodium, cholesterol or micronutrient totals as reliable when contributing foods are missing those fields. Show a completeness percentage instead.
- This fits the repo's guidance to prefer "deterministic summaries and explicit confidence/readiness signals".

### Gaps

- **Braakhuis 2017:** could not be located or verified this session (searches returned only unrelated MFP studies). Do not cite until found.
- No primary study of Cronometer's database accuracy was retrievable (JAND 2020 and JHND 2025 both returned 403). Claims that Cronometer is "curated" should come from Cronometer's own docs, which were not fetched.

## 6. Barcode scanning (Expo/React Native, web) and GTIN normalization

### Takeaway

Android ML Kit (via expo-camera) handles EAN-13/EAN-8/UPC-A/UPC-E well. Expo's iOS `launchScanner` and `scanFromURLAsync` have limits, so live `CameraView` with `barcodeScannerSettings` is the main path. On the web, `BarcodeDetector` is not Baseline: Chromium has it, Firefox does not, and Safari has it off by default. A ZXing-based WASM/JS fallback is mandatory for web/PWA. Normalize every scanned code to GTIN-14 before lookup, and treat GS1 prefix 02/20–29 codes as in-store/variable-measure (no global lookup).

### Cited Findings

- expo-camera (SDK 57 docs) barcode types: aztec, ean13, ean8, qr, pdf417, upc_e, datamatrix, code39, code93, itf14, codabar, code128, upc_a. — [Expo Camera docs](https://docs.expo.dev/versions/latest/sdk/camera/)
- `scanFromURLAsync`: "Only QR codes are supported on iOS. On android, the barcode should take up the majority of the image for best results." — [Expo Camera docs](https://docs.expo.dev/versions/latest/sdk/camera/)
- `launchScanner()` is Android/iOS only, not web. On iOS it uses Apple's `DataScannerViewController` (iOS 16+); on Android, Google Code Scanner (ML Kit). — [Expo Camera docs](https://docs.expo.dev/versions/latest/sdk/camera/)
- MDN marks BarcodeDetector "Experimental", "Limited availability" / not Baseline, secure-context only, and available in Web Workers. `BarcodeDetector.getSupportedFormats()` returns the formats a platform supports. — [MDN BarcodeDetector](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector)
- caniuse (retrieved 2026-10-02): Chrome desktop 83–157 partial support (Windows/Linux/macOS); Chrome Android 154 supported; Edge 83–154 partial; Safari macOS up to 27.1 and iOS up to 27.2 "Disabled by default"; Firefox up to 160 not supported; Samsung Internet 13–30 supported. — [caniuse BarcodeDetector](https://caniuse.com/mdn-api_barcodedetector)
- GS1 prefix 02 and 20–29 are Restricted Circulation Numbers (RCNs), defined per GS1 Member Organisation / geographic region. They are used for variable-measure trade items (VMN-13 in EAN-13). A suggested price-embedded layout is prefix (2) + department (2–3) + item (3) + price (5) + check digit. — [GS1 summary of prefixes 20–29 by MO](https://www.gs1.org/docs/barcodes/SummaryOfGS1MOPrefixes20-29.pdf); [GS1 Sweden RCN guide](https://gs1.se/en/support/how-do-i-create-my-variable-weight-numbers/); [GS1 Australia variable measure fact sheet](https://assets.ctfassets.net/9uypwcnuzbqi/PlyyuvpxJtvubTH7KoIJO/96be9181fda515d6d39b525cb0d5d3e2/GS1au-fact-sheet-variable-measure-retail.pdf) (via search snippets; the gs1.org GTIN page returned 403)

### Inferences

- Background knowledge, not re-verified this session because gs1.org returned 403:
  - GTIN-8/12/13/14 are stored right-justified in a 14-digit field with leading zeros.
  - A UPC-A (GTIN-12) equals the EAN-13 with a leading "0", so `012345678905` and `0012345678905` are the same item.
  - UPC-E must be expanded to UPC-A before normalizing.
  - The mod-10 check digit should be validated.
  - Prefixes 978/979 (ISBN) and 977 (ISSN) are not food items.
- Normalization approach: store `gtin14` as the canonical key in OpenValens. Query OFF with the 13-digit form (OFF codes are mostly EAN-13, with some UPC-A stored as 12 digits). Match FDC Branded `gtin_upc` after zero-padding.
- Variable-measure/in-store codes (02/20–29, and UPC "2" number-system codes in the US) encode a store-local item plus a price or weight, and the layout varies by country MO (Portugal, UK and US differ). Never send these to OFF/FDC as global keys. Treat them as user-private custom foods keyed by store + item segment, and optionally parse the weight when the local MO layout is known.
- iOS through Expo: `CameraView` live scanning with `barcodeScannerSettings={{ barcodeTypes: ['ean13','ean8','upc_a','upc_e'] }}` is the expected path. The QR-only limitation applies to `scanFromURLAsync` on iOS, not to live scanning. That is inferred from the doc wording and should be tested on a device. On iOS, AVFoundation often reports UPC-A as EAN-13 with a leading 0, which normalization handles (background knowledge).
- Web/PWA: feature-detect `BarcodeDetector` and check `getSupportedFormats()` for `ean_13`. Otherwise fall back to a ZXing-based decoder (`@zxing/browser`, or a ZXing-C++ WASM build such as `zxing-wasm`). Safari and Firefox users will always use the fallback.

### Gaps

- GS1 General Specifications primary text for GTIN normalization: gs1.org returned 403.
- Portugal-specific (GS1 Portugal) and UK variable-measure layouts were not retrieved. They are in the GS1 "Summary of prefixes 20–29 by MO" PDF, which was found but not fetched.
- The Expo docs fetch summary was partly ambiguous about iOS live-scan format support. Verify on a device.

## 7. User-contributed foods: moderation and licensing

### Takeaway

Default user-created foods to private and per-tenant, which keeps them clear of ODbL and avoids PHI leakage. Offer an explicit opt-in "contribute to Open Food Facts" flow for barcoded products, using the OFF write API with the user's own OFF account (or an app account plus `app_name`/`app_uuid`), so shared corrections live upstream under ODbL rather than in a divergent OpenValens database.

### Cited Findings

- OFF writes need authenticated credentials (session cookie or `user_id`/`password`) and should carry `app_name`, `app_version`, `app_uuid` "for user contribution tracking". Writes have no rate limit. — [OFF API docs](https://openfoodfacts.github.io/openfoodfacts-server/api/)
- OFF asks reusers to contribute modifications back under ODbL. — [OFF Data page](https://world.openfoodfacts.org/data)
- ODbL share-alike applies only to _publicly used_ derivative databases. Internal use and use by entities under your control are exempt (§4.5; definition of "Publicly"). — [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- Crowd-sourced databases contain erroneous and incomplete entries that need cleaning (2.8% of logged items removed as implausible in Evenepoel 2020). — [Evenepoel 2020](https://pmc.ncbi.nlm.nih.gov/articles/PMC7641788/)

### Inferences

- Contribution terms: anything a user contributes to OFF goes in under ODbL/DbCL (and CC BY-SA for photos), which is irreversible. The UI needs an explicit, consent-gated confirmation, and photos must be scrubbed of faces, receipts and location EXIF. This matches the repo's consent and PHI-minimization rules.
- Hosted-service question **[COUNSEL]**: if the maintainer-run service lets users share custom foods with each other (a "community" database), OpenValens's terms need a contributor license, ideally ODbL/DbCL or CC0, so the shared DB can be published. If those shared foods were copied from OFF, the shared DB is ODbL anyway.
- Moderation for any shared tier:
  - Run Atwater/plausibility checks at submit.
  - Require a label photo or source for promotion.
  - Show a "verified/unverified" badge.
  - Rate-limit new accounts.
  - Prefer routing barcoded items to OFF, where OFF's own moderation and quality "facets" apply, instead of running a parallel moderation system.
- Self-hosted instances are typically single-tenant/family, so ODbL "publicly" is arguably not triggered for local edits. The maintainer-run multi-tenant service is clearly "public". **[COUNSEL]** to confirm whether serving different organizations on one hosted instance counts as public use (almost certainly yes).

### Gaps

- OFF's published moderation and quality-check processes (e.g. the data-quality facets and Robotoff) were not fetched this session.
- No source was found on how other open-source trackers (e.g. Waistline, OpenNutriTracker) structure ODbL compliance. That would be useful precedent.
