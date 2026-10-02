# Exercise datasets and body/muscle diagram libraries (tickets #93 and #94), verified October 2026

Method: GitHub repo metadata, LICENSE/NOTICE/README text, and issue threads were pulled with `gh api` on 2026-10-02. The wger numbers come from live calls to `https://wger.de/api/v2/` on the same day. Star counts are as of 2026-10-02.

## Q1. Exercise datasets: licenses, where the media comes from, and quality

### Takeaway

Ticket #93 gets the license of `hasaneyldrm/exercises-dataset` wrong. The dataset is not public domain and not CC/CC-BY. The code and text are MIT, but every GIF and thumbnail is © Gym visual. The repo has permission to redistribute them, and that permission does not pass to anyone who clones it. Gym visual's own terms forbid further redistribution. Shipping or hotlinking those GIFs in openhealth would be copyright infringement.

The images in yuhonas/free-exercise-db and wrkout/exercises.json are also not clean. Their maintainers say the images were scraped, and reverse image search points to bodybuilding.com and ExRx. Only their JSON text is plausibly public domain (Unlicense).

wger is the only source where the data and images are openly licensed (CC-BY-SA 3/4 and CC0). Its code is also AGPL, which matches openhealth's license. It is the best fit.

### Cited findings

**hasaneyldrm/exercises-dataset**

- The repo exists. It has 22,463 stars and was created 2026-03-18. The last push was 2026-07-16. GitHub's license detection reports "NOASSERTION" — [GitHub API repos/hasaneyldrm/exercises-dataset](https://github.com/hasaneyldrm/exercises-dataset)
- The ticket says 6 languages. The README now says 1,324 exercises with instructions in **10** languages (en, es, it, tr, ru, zh, hi, pl, ko, fr). Hindi, Polish, Korean and French were added 2026-07-09/10 — [README](https://github.com/hasaneyldrm/exercises-dataset/blob/main/README.md), [commits](https://github.com/hasaneyldrm/exercises-dataset/commits/main)
- The LICENSE file is MIT plus a "MEDIA EXCEPTION". Quote: "The MIT license above covers ONLY the code, tooling, dataset structure, and instruction text/translations… It DOES NOT cover the exercise media in the `images/` and `videos/` directories. That media is © Gym visual (https://gymvisual.com/) and is included here with the rights holder's written permission, at 180×180 resolution… Cloning this repository does not grant you any license to the media; obtain your own from Gym visual." — [LICENSE](https://github.com/hasaneyldrm/exercises-dataset/blob/main/LICENSE)
- NOTICE.md says the media must carry "© Gym visual — https://gymvisual.com/", stay at 180×180, and "This repository does not grant you any rights to the media beyond what Gym visual's terms allow — cloning this repo is not a license." — [NOTICE.md](https://github.com/hasaneyldrm/exercises-dataset/blob/main/NOTICE.md)
- Gym visual's terms say: "None of our Media may be resold or redistributed by any means, or made available for redistribution or resale by a third party." They sell a paid "Non-Exclusive Commercial Royalty-Free License" that allows use in apps and websites — [Gym visual T&C](https://gymvisual.com/content/3-terms-and-conditions-of-use)
- The git history was rewritten. The single root commit "exercises-dataset: 1,324 multilingual gym exercises with media" is dated 2026-07-08, but the repo was created in March. LICENSE and NOTICE.md first appear in that commit — [commits?path=LICENSE](https://github.com/hasaneyldrm/exercises-dataset/commits/main/LICENSE)
- Issue #3, "Copyright issues ?" (opened 2026-05-30), is still open. Commenters cite an earlier README "disclaimer" saying "educational and non-commercial usage" only. One commenter, 2026-08-19, calls the media exclusion a "copyright trap" — [Issue #3](https://github.com/hasaneyldrm/exercises-dataset/issues/3)
- Quality issues are open as well: #86 (a GIF shows the wrong exercise) and #50 (requests for higher-resolution media) — [issues](https://github.com/hasaneyldrm/exercises-dataset/issues)
- Schema: `data/exercises.json` is 17.4 MB. It ships with a JSON Schema (draft 2020-12). Fields: id, name, category, body part, target, `muscle_group`, `secondary_muscles`, equipment, per-language instructions and `instruction_steps`, `media_id`, `image`, `gif_url`, `attribution`. The whole repo is about 128 MB — [README](https://github.com/hasaneyldrm/exercises-dataset/blob/main/README.md)
- The dataset is the data layer for the author's commercial "LogPress" app — [README](https://github.com/hasaneyldrm/exercises-dataset/blob/main/README.md)

**yuhonas/free-exercise-db**

- Unlicense, 1,946 stars, last push 2026-09-27, actively maintained. It has 800+ exercises in 1,000 exercise directories, with 2 JPGs each. Repo size is about 97 MB. The combined `dist/exercises.json` is about 1 MB — [repo](https://github.com/yuhonas/free-exercise-db)
- The schema is clean and uses enums: force (push/pull/static), level, mechanic (compound/isolation), equipment (12 values), primaryMuscles/secondaryMuscles (17 values), instructions, category, images — [schema.json](https://github.com/yuhonas/free-exercise-db/blob/main/schema.json)
- The maintainer on image provenance (2023): "I actually have no idea where the images are from or if they are royalty free so usage would be at your own risk" — [Issue #2](https://github.com/yuhonas/free-exercise-db/issues/2)
- On 2026-08-01 a user said some images "appear to be from ExRx.net". On 2026-08-02 the maintainer suggested replacing the images with placeholders while keeping the schema. Newer exercise PRs come without images, and their instructions are "AI generated" — [Issue #13](https://github.com/yuhonas/free-exercise-db/issues/13), [PR #32](https://github.com/yuhonas/free-exercise-db/pull/32)
- There is no translation support yet. Issue #9 "Translations" is open — [Issue #9](https://github.com/yuhonas/free-exercise-db/issues/9)

**wrkout/exercises.json** (the upstream of yuhonas)

- Unlicense, 637 stars. The last real commit was 2025-02-16, a README change that advertises the paid commercial dataset at wrkout.xyz. The repo is effectively unmaintained — [repo](https://github.com/wrkout/exercises.json)
- CONTRIBUTING.md, as quoted in issue #305: images "have been scraped off the internet, therefore l do not own the copyright for these images and would advise against using them in commercial projects". Reverse image search points to bodybuilding.com as one source — [Issue #305](https://github.com/wrkout/exercises.json/issues/305)

**wger (wger.de / wger-project/wger)**

- The server is AGPL-3.0-or-later, has 6,997 stars, and was last pushed 2026-10-01. Its README says: "Exercise/Ingredient Data: Creative Commons (see individual entries)" — [wger README](https://github.com/wger-project/wger)
- Live API, 2026-10-02: 916 exercises. Licenses: 763 CC-BY-SA 4, 132 CC-BY-SA 3, 21 CC0. The license and `license_author` are stored per entry. There are 376 images (288 CC-BY-SA 4, 88 CC-BY-SA 3) covering 276 exercises, and 78 videos — [exerciseinfo](https://wger.de/api/v2/exerciseinfo/), [exerciseimage](https://wger.de/api/v2/exerciseimage/), [license](https://wger.de/api/v2/license/)
- Translation coverage by number of exercises: en 916, es 645, de 631, fr 584, it 138. Most other languages have about 50 or fewer. There are 33 language codes in total — [language](https://wger.de/api/v2/language/)
- Muscles: 15 muscle groups with `is_front` and per-muscle SVG overlays. 770 of the 916 exercises have muscles assigned. The base body SVGs credit Wikimedia Commons "Muscular_system.svg" and "Muscular_system-back.svg" — [muscle API](https://wger.de/api/v2/muscle/), [SOURCES](https://github.com/wger-project/wger/blob/master/wger/core/static/images/muscles/SOURCES)

**ExerciseDB**

- `ExerciseDB/exercisedb-api` on GitHub has 687 stars and an AGPL-3.0 badge, but it contains only README.md and LICENSE, so there is no code or data to use. The README points to RapidAPI and paid pricing plans and claims "11000+ exercises" and "5,000+ GIF animations" — [repo](https://github.com/ExerciseDB/exercisedb-api)
- A free "ExerciseDB V1 API" exists at oss.exercisedb.dev (1,500 exercises, GIFs, no key). Search snippets say the open-source tier gives "180p resolution" media. I could not fetch its terms — [oss.exercisedb.dev/docs](https://oss.exercisedb.dev/docs), [exercisedb.dev](https://exercisedb.dev/)

**Others found but not evaluated in depth:** JahelCuadrado/ExerciseGymGifsDB (1,323 GIFs served through jsDelivr), WorkoutX (paid API), and a Kaggle "Fitness Exercises Dataset" by exercisedb — [search results](https://github.com/JahelCuadrado/ExerciseGymGifsDB), [WorkoutX](https://workoutxapp.com/), [Kaggle](https://www.kaggle.com/datasets/exercisedb/fitness-exercises-dataset). `everkinetic/everkinetic-data` returns 404 on GitHub.

### Inferences

- Both datasets have 1,324 exercises at 180×180, and both have 4-digit IDs with a 7-character media id (e.g. `0025-EIeI8Vf`). This strongly suggests hasaneyldrm is a repackaged ExerciseDB v1 corpus, and ExerciseDB's GIFs are Gym visual animations. This is not verified, but it is consistent with both projects being 180-px Gym visual media.
- For an AGPL app that others self-host, **none** of the GIF/JPG sets from hasaneyldrm, yuhonas, wrkout or ExerciseDB can safely be bundled or hotlinked. The MIT/Unlicense JSON text (names, muscles, equipment, instructions) from hasaneyldrm and yuhonas is usable with attribution, though the same provenance doubt about scraped text applies with less force.
- Recommended stack:
  1. Use wger data as the canonical exercise catalog (CC-BY-SA; keep the per-entry `license_author` for attribution; the CC-BY-SA share-alike obligation covers the data only, not openhealth's code).
  2. Use yuhonas JSON (Unlicense) to fill gaps in the muscle/equipment taxonomy, without the images.
  3. Show media only where the license is clear (wger CC images, or the app's own SVG muscle highlight instead of GIFs).
- Correct ticket #93's alternatives list: "RepDB" could not be found or verified in this pass.

### Gaps

- I could not see the pre-2026-07-08 README/LICENSE of hasaneyldrm because the history was rewritten. The ticket's "Public-domain (CC)" / "CC-BY" wording probably reflects an earlier state that can no longer be verified.
- I could not fetch the oss.exercisedb.dev terms of use, and did not confirm whether ExerciseDB's media is Gym visual's.
- "RepDB" was not located.
- I did not check the license of the Wikimedia Muscular_system.svg files that wger's body outline uses.

## Q2. Hotlinking raw.githubusercontent.com compared with self-hosting

### Takeaway

Do not hotlink. raw.githubusercontent.com is not a CDN. GitHub tightened unauthenticated rate limits on it in May 2025, and it does not accept auth tokens. Bandwidth abuse can get the source repo throttled. Hotlinking would also send every user's IP address and the exercise they are viewing to GitHub, a third party, which conflicts with openhealth's PHI-minimizing posture. Bundle or self-host only the assets that are licensed for it.

### Cited findings

- GitHub's changelog of 2025-05-08 announced "updated rate limits for unauthenticated requests" covering "cloning repositories over HTTPS, anonymously interacting with our REST APIs, and downloading files from raw.githubusercontent.com". It gives no numbers — [GitHub Changelog](https://github.blog/changelog/2025-05-08-updated-rate-limits-for-unauthenticated-requests/)
- Community reports describe HTTP 429 errors on raw.githubusercontent.com after the change. Tokens sent to raw.githubusercontent.com are reportedly ignored — [community discussion #160828](https://github.com/orgs/community/discussions/160828), [discussion #159123](https://github.com/orgs/community/discussions/159123), [bazarr #3057](https://github.com/morpheus65535/bazarr/issues/3057)
- GitHub Acceptable Use Policies, section on excessive bandwidth: "If we determine your bandwidth usage to be significantly excessive in relation to other users of similar features, we reserve the right to suspend your Account, throttle your file hosting, or otherwise limit your activity" — [GitHub AUP](https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies)
- The yuhonas README explicitly suggests prefixing image paths with the raw.githubusercontent.com URL. That is a convenience suggestion, not a hosting guarantee — [yuhonas README](https://github.com/yuhonas/free-exercise-db)
- Asset sizes: hasaneyldrm repo is about 128 MB (JSON alone 17.4 MB). yuhonas repo is about 97 MB (JSON about 1 MB). wger has 376 images, served from its own media server with 200/400-px thumbnails — [GitHub API size fields](https://github.com/hasaneyldrm/exercises-dataset); [wger exerciseimage](https://wger.de/api/v2/exerciseimage/)

### Inferences

- The "about 83 requests/min down to 1/min" figure in search snippets is a third-party claim, not GitHub's documentation. Treat it as unverified.
- For self-hosters, the right pattern is a one-time import job. It pulls the wger JSON and CC images into openhealth's own object storage or static directory, records license and author per asset, and serves them from the openhealth origin. The mobile app can cache them. This keeps the IP/exercise-view signal inside the user's own deployment.

### Gaps

- GitHub publishes no official numeric limit for raw.githubusercontent.com.

## Q3. Body diagram libraries

### Takeaway

`vulovix/body-muscles` exists and is Apache-2.0, which is compatible with AGPLv3. It has 89 regions (40 front, 49 back) and a 0–10 intensity scale. However, it is tiny (30 stars, one npm release 1.0.0 on 2026-04-14, last commit 2026-04-16), and its renderer builds DOM nodes, so it does **not** run in React Native. Its path data is plain `d` strings that react-native-svg's `<Path>` can render.

The safer choice for Expo is `react-native-body-highlighter` (MIT, 294 stars, maintained, Expo-compatible, male/female, front/back). For web, use its web sibling `react-muscle-highlighter` (MIT) or `react-body-highlighter` (MIT).

A single shared module of SVG path data (id to path to view) with thin renderers works on both web `<svg>` and react-native-svg.

### Cited findings

- **vulovix/body-muscles**: Apache-2.0, 30 stars. Created 2026-04-14, with 4 commits up to 2026-04-16. npm `body-muscles` has only version 1.0.0 (2026-04-14). It describes itself as "zero-dependency, framework-agnostic… 70+ muscles… intensity 0–10 (yellow → orange → red)". The NOTICE reads "Copyright 2024 Ivan Vulović" — [repo](https://github.com/vulovix/body-muscles), [npm](https://www.npmjs.com/package/body-muscles)
- Its source has `muscles.front.ts` with 40 region ids and `muscles.back.ts` with 49. Regions include non-muscle areas (head, face, elbow, spine) and left/right splits such as `chest-upper-left` and `lats-mid-right`. `BodyChart.ts` uses `document.createElementNS`, `document.createElement` and `document.getElementById`, so it needs a DOM — [src/data](https://github.com/vulovix/body-muscles/tree/main/src/data), [BodyChart.ts](https://github.com/vulovix/body-muscles/blob/main/src/BodyChart.ts)
- **react-native-body-highlighter**: MIT, 294 stars, last push 2026-09-17. v3.2.0 is on npm (2026-04-13) and depends on `react-native-svg ^15.9.0`. It has "Expo compatible" male/female front/back views, per-part `intensity` mapped to a `colors` array, left/right side selection, `onBodyPartPress`, and accessibility labels. Slugs: trapezius, triceps, forearm, adductors, calves, hair, neck, deltoids, hands, feet, head, ankles, tibialis, obliques, chest, biceps, abs, quadriceps, knees, abductors, upper-back, lower-back, hamstring, gluteal — [repo](https://github.com/HichamELBSI/react-native-body-highlighter)
- **react-muscle-highlighter** lives at `soroojshehryar/react-muscle-highlighter`. The ticket's `soroojshehryar01` path returns 404. It is MIT with 44 stars and was last pushed 2026-01-07. It is a React (web) component with the same `slug` / `intensity` / `colors` / `disabledParts` API — [repo](https://github.com/soroojshehryar/react-muscle-highlighter)
- **giavinh79/react-body-highlighter** (web): MIT, 51 stars, last push 2026-09-20. It takes exercise data `{name, muscles[], frequency}` and colors muscles by how often they were worked. In other words, it is built for training-volume heatmaps — [repo](https://github.com/giavinh79/react-body-highlighter)
- Other options: melihcolpan/MuscleMap (SwiftUI, MIT, 263 stars), binarybeastt/musclemap (Jetpack Compose, MIT), wger's own CC-licensed front/back muscle SVG overlays (15 groups) — [search](https://github.com/melihcolpan/MuscleMap), [wger muscles](https://wger.de/api/v2/muscle/)

### Inferences

- Apache-2.0 and MIT code can be included in an AGPLv3 project. Apache-2.0 requires keeping the NOTICE file.
- Architecture: create a shared package such as `@health/body-map`. It would export the region ids, display names, front/back flag, and path `d` strings, plus a mapping from exercise-catalog muscle names (wger 15 / yuhonas 17) to region ids. A web renderer (`<svg><path>`) and an RN renderer (`react-native-svg` `<Svg><Path>`) would both consume it. The path data could be vendored from body-muscles (Apache-2.0) or react-native-body-highlighter (MIT).
- body-muscles' single-maintainer, one-release status makes it a reasonable source to vendor path data from. It is a poor choice as a runtime dependency.

### Gaps

- I did not verify where body-muscles' or react-native-body-highlighter's SVG paths originally came from.
- I did not check whether react-native-body-highlighter renders on react-native-web.

## Q4. Science check for #94: can regional fat change be inferred from total weight change?

### Takeaway

No. Ticket #94's assumed 30% upper / 70% lower split is invented, and drawing per-region intensity from total weight would show made-up anatomy as if it were measured. Two lines of evidence:

- Spot reduction does not happen. A 2022 meta-analysis of 13 studies found a pooled effect size of −0.03.
- How fat loss is distributed by region varies with sex, starting adiposity and the individual. Where DXA shows a pattern, the trunk usually loses the most, not the legs.

Defensible visualizations are (a) measured values by site (DXA regional results, tape circumference by site) and (b) training-volume or recovery heatmaps by muscle group, which is how Hevy and Fitbod use body maps.

### Cited findings

- Ramirez-Campillo R, Andrade DC, Clemente FM, Afonso J, Pérez-Castilla A, Gentil P. _Human Movement_ 2022;23(3):1–14, doi:10.5114/hm.2022.110373. The meta-analysis covered 13 studies with 1,158 participants and 37 comparisons. 17 comparisons favored the trained limb and 20 favored the untrained limb. Pooled ES = −0.03 (95% CI −0.10 to 0.05, p = 0.508), I² = 24.3%. Conclusion: "localized muscle training had no effect on localized adipose tissue depots" — [Human Movement](https://hummov.awf.wroc.pl/A-proposed-model-to-test-the-hypothesis-of-exercise-induced-localized-fat-reduction,143162,0,2.html)
- Ramírez-Campillo et al., JSCR 2013. Eleven participants trained only the nondominant leg for 12 weeks (leg press, 960–1,200 reps per session at 10–30% 1RM). Body fat mass fell 5.1%, with significant fat loss in the **upper extremities (−10.2%) and trunk (−6.9%)**, "not achieved in the trained body segment" (DXA) — [PubMed 23222084](https://pubmed.ncbi.nlm.nih.gov/23222084/)
- Vispute et al., JSCR 2011;25(9). In an RCT of 24 people, 6 weeks of abdominal exercise had no significant effect on body weight, body fat %, android fat, abdominal circumference or abdominal skinfolds — [PubMed 21804427](https://pubmed.ncbi.nlm.nih.gov/21804427/), [JSCR full text](https://journals.lww.com/nsca-jscr/fulltext/2011/09000/the_effect_of_abdominal_exercise_on_abdominal_fat.27.aspx)
- The NSCA trainer tip sheet says spot reduction does not work — [NSCA PDF](https://www.nsca.com/contentassets/60c4deb55cd640549806ed8f3f170b9e/trainertips_spot-reduction.pdf)
- The Physician and Sportsmedicine 2017;45(4), doi:10.1080/00913847.2017.1380500, studied how previous BMI and sex affect regional fat changes in a weight-loss intervention. Search-result summaries say that relative to total loss the trunk loses the most fat, then legs, then arms, with men losing more trunk and android mass than women. The full text returned 403, so these specifics come from the search summary only — [T&F abstract](https://www.tandfonline.com/doi/abs/10.1080/00913847.2017.1380500)
- DXA regional fat distribution differs by ethnicity and sex — [Nutrition & Diabetes 2013](https://www.nature.com/articles/nutd20135), [PMC3798591](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3798591/)

### Inferences

- The fixed 30/70 split contradicts the DXA evidence above, where trunk loss typically leads, and ignores sex and individual differences. Persisting "per-region intensity snapshots" made from that model would put fabricated data into a PHI record. It breaks the repo rule "prefer deterministic summaries and explicit confidence/readiness signals" and gets in the way of later clinical export.
- A "muscle balance" insight cannot come from weight data. It can only come legitimately from logged training volume (sets per muscle group, push/pull or anterior/posterior ratios) or from measured left/right circumferences.
- Defensible body-map uses for openhealth:
  1. Training-volume heatmap: weekly sets per muscle group from logged workouts mapped through the exercise catalog's primary/secondary muscles, e.g. 1.0 for primary and 0.5 for secondary.
  2. Recovery/recency map: time since each muscle group was last trained.
  3. Measured-site overlay: tape-measure circumference changes (waist, hips, arm, thigh, chest) or DXA regional values (arms, legs, trunk, android, gynoid) colored only where real measurements exist, with dates and source provenance.

### Gaps

- I did not retrieve the full text of the 2017 Physician and Sportsmedicine paper, so its exact regional percentages are unverified.
- I did not look for studies on the reliability of tape circumference compared with DXA for tracking regional change.

## Q5. What do Hevy, Strong, Fitbod and wger use muscle diagrams for?

### Takeaway

They all use the body map for training stimulus: which muscles you worked, how much, and how recovered they are. None uses it to estimate where fat or weight changed. That is the pattern openhealth should copy.

### Cited findings

- Hevy has a "last 7 days" body graph showing the muscle groups trained, a "Muscle distribution (Body)" view of sets per muscle group for the current week, and a heatmap shown while logging a workout — [Hevy muscle group chart](https://www.hevyapp.com/features/muscle-group-workout-chart/), [Hevy statistics help](https://help.hevyapp.com/hc/en-us/articles/35702030346903-Hevy-Statistics-Explained-Track-Your-Training-Progress-and-Muscle-Growth), [sets per muscle group](https://www.hevyapp.com/features/sets-per-muscle-group-per-week/)
- Fitbod shows a recovery heat map with a 0–100% recovery value per muscle group and uses it to prioritize fresher muscles in generated workouts — [Fitbod muscle recovery](https://fitbod.me/blog/muscle-recovery/), [Fitbod volume/recovery](https://fitbod.me/blog/tracking-volume-intensity-and-recovery-with-fitbod/)
- wger shows front/back muscle SVGs with main and secondary highlights for each exercise, marking which muscles the exercise targets — [wger muscle API](https://wger.de/api/v2/muscle/)
- An open-source tracker (a SparkyFitness fork) added a "Hevy-style muscle heat map (count working sets, exclude warm-ups)" — [PR #19](https://github.com/Jerrys-modz/SparkyFitness/pull/19)

### Inferences

- If #94 is reframed as a weekly training-volume and recovery body map driven by logged workouts and catalog muscle mappings, it matches established practice and needs no invented physiology. Body composition belongs in a separate measured-site view.

### Gaps

- I did not find primary documentation for Strong's muscle visualization in this pass and could not verify whether Strong has a body-map feature.
