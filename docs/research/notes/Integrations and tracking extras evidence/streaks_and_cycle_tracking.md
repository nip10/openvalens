# Logging streaks/gamification and menstrual cycle tracking: evidence for tickets #90 and #91

Research date: 2026-10-02. Scope: an AGPL, self-hostable wellness app (openhealth) with a neutral, non-judgemental nutrition diary. Evidence grades: **Strong** means meta-analysis, RCT or a large dataset. **Moderate** means one peer-reviewed study or several small ones. **Weak** means vendor or blog claims, or secondary reporting.

---

## Q1. Do streaks and gamification improve health-behaviour adherence, how long do the effects last, and what harms do they cause?

### Takeaway

Gamification produces a small-to-moderate short-term effect on health behaviour, and the effect largely fades after the intervention ends (Strong). Peer-reviewed experiments show that a broken streak lowers continuation, even when the break was outside the person's control (Moderate–Strong). "Forgiving" mechanics such as freezes and repair are supported mostly by vendor-reported data (Weak). So calling streaks "a known retention lever" is an engagement claim, not a health-outcome claim. It also comes with a documented downside after the streak breaks.

### Cited Findings

- Mazéas et al. 2022, a meta-analysis of 16 RCTs with 2,407 participants: gamified interventions had a small-to-medium effect on physical activity (Hedges g=0.42, 95% CI 0.14–0.69). At about 14 weeks of follow-up the effect shrank to g=0.15 (0.07–0.23). Against active non-gamified controls the effect was g=0.23. On total physical activity after follow-up it was non-significant (g=0.09, −0.07 to 0.26). **Strong.** — [JMIR 2022;24(1):e26779](https://www.jmir.org/2022/1/e26779)
- Silverman & Barasch 2023, six studies in the _Journal of Consumer Research_ 49(6):1095–1117: highlighting an intact streak in a behaviour log increases later engagement compared with highlighting a broken one. A broken streak makes people less likely to continue the behaviour, even when outside events caused the break. **Moderate–Strong (experimental; consumer-behaviour field, not clinical).** — [CU Boulder summary](https://www.colorado.edu/business/faculty-research/2023/04/19/or-track-how-broken-streaks-affect-consumer-decisions); [author research page](https://www.jackiesilverman.com/research); [Psychology Today commentary](https://www.psychologytoday.com/gb/blog/ulterior-motives/202306/how-broken-streaks-sap-motivation)
- Duolingo says it has run "600+" streak experiments. Streak Freeze reportedly cut churn by 21% among users at risk of losing a streak. Duolingo also found that more flexibility early in a streak (for example, two free freezes at the start) improves retention, and that retention "drops abruptly if a streak is lost". **Weak**: company figures repeated in podcasts and blogs, with no peer review and an engagement metric rather than a health outcome. — [Lenny's Podcast summary (Jackson Shuttleworth, Duolingo)](https://www.getrecall.ai/summary/lennys-podcast/behind-the-product-duolingo-streaks-or-jackson-shuttleworth-group-pm-retention-team); [elsewhere.news write-up](https://elsewhere.news/en/linearcapital/duolingobolt)
- Industry commentary names "streak creep" (pressure and anxiety that build as the streak grows, then abandonment when it breaks) as a known failure mode. **Weak / opinion.** — [The Decision Lab](https://thedecisionlab.com/insights/consumer-insights/streak-creep-the-perils-of-too-much-gamification)
- Cronometer has a consecutive-days logging streak. Its own forum shows users worrying about losing streaks after missed days. **Weak (vendor + user forum).** — [Cronometer blog: Streaks](https://cronometer.com/blog/new-feature-streaks); [Cronometer forum thread](https://forums.cronometer.com/discussion/5792/streaks)
- Some secondary sources cite large figures, such as "+340% engagement", "adherence 62%→89%", or a "JAMA Psychiatry review of 79 trials". These come from vendor blogs (sahha.ai, routinery.app) with no traceable primary citations, so **do not use them**. — [sahha.ai blog](https://sahha.ai/blog/gamification-behavioral-nudges-health-apps/); [routinery blog](https://www.routinery.app/blog/micro-rewards-vs-streaks-adherence-science)

### Inferences

- Ticket #90's design (consecutive days, reset on a missed day, "longest streak") is the configuration that Silverman & Barasch show demotivates after a break. Mazéas suggests whatever benefit it brings does not last.
- Even Duolingo, the strongest commercial advocate of streaks, adds forgiveness (freezes, repair) because a hard reset causes churn. In a diary that must not shame anyone, a hard reset conflicts with the existing product decision of "no streak punishment".
- Self-determination theory suggests that extrinsic, loss-framed counters can undermine autonomy and intrinsic motivation. I did not retrieve a primary SDT paper on streaks specifically, so this point is theory-based and not cited here.

### Gaps

- I found no peer-reviewed RCT that isolates streaks (as opposed to gamification bundles) in food logging, and no peer-reviewed evaluation of streak freezes.
- I could not verify how MyFitnessPal currently handles streaks (it has historically shown a "days logged in a row" counter), or how Finch and Bearable handle missed days. Searches returned no primary documentation, so check their help centres directly.
- No primary SDT critique of streaks was retrieved.

---

## Q2. Is calorie/food-tracking gamification linked to disordered eating, and what do eating-disorder charities advise?

### Takeaway

There is a consistent cross-sectional link between calorie-tracking apps and eating-disorder (ED) symptoms (Moderate). The best reading is that tracking interacts with existing vulnerability, not that it causes ED in the general population. People with ED often say MyFitnessPal contributed to their illness. ED charities advise screening, signposting and limits. This supports keeping streaks off by default and disabling them for anyone who declared an ED exclusion.

### Cited Findings

- Simpson & Mazzeo 2017 (_Eating Behaviors_, college students): calorie tracking was associated with eating concern and dietary restraint. Tracking frequency was linked to restraint and bulimic symptoms only in people with existing body dissatisfaction or weight-related anxiety. **Moderate (cross-sectional).** — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1471015316303646)
- Levinson et al. 2017 (_Eating Behaviors_ 27:14–16, ED patients): 73.1% of patients who used MyFitnessPal said it at least somewhat contributed to their eating disorder, and 62.9% said it at least moderately contributed. These perceptions correlated with ED symptoms. **Moderate (clinical sample, self-report).** — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1471015317301484); [PMC5700836](https://pmc.ncbi.nlm.nih.gov/articles/PMC5700836/)
- Linardon & Messer 2019 (_Eating Behaviors_, 122 men): MyFitnessPal users had more ED symptoms and psychosocial impairment than non-users. MyFitnessPal use predicted unique variance in global ED symptoms after controlling for confounds. About 40% of users felt the app contributed to their symptoms. **Moderate (cross-sectional).** — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S147101531830326X)
- Berry et al. 2024 (_International Journal of Eating Disorders_) examined longitudinal links between fitness tracking and disordered eating in college women. I did not retrieve the details. — [Wiley](https://onlinelibrary.wiley.com/doi/full/10.1002/eat.24192)
- A 2025 systematic review on fitness and diet tracking technology and disordered eating behaviour exists (PMC12547374). I did not retrieve the details. — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC12547374/)
- Beat (UK ED charity), via press coverage: calorie-tracking apps can be "incredibly attractive" to people with ED. Beat calls for ED screening at sign-up, regular check-ins, signposting to services when unhealthy data is entered, blocking unhealthy goals rather than just showing a pop-up, and daily time limits. **Weak (press summary of charity position, not a formal design standard).** — [Tyla, 2023](https://www.tyla.com/health/calorie-counting-apps-impact-eating-disorders-354995-20230403)

### Inferences

- Taken together, the ED evidence points to consistency signals that are opt-in, non-loss-framed and non-competitive, and that are disabled or hidden for users with a declared ED exclusion or hide-numbers mode on. That matches the existing nutrition-module decisions.
- A "days logged this week" count with no reset avoids the all-or-nothing framing. The abstinence-violation-effect pattern is theory-consistent but not directly tested in this literature.

### Gaps

- I did not find primary NEDA guidance on app design. NEDA shut its helpline in 2023, and I did not find a current published app-design standard from it.
- No study tests streaks specifically as an ED risk factor; the evidence covers calorie tracking in general.

---

## Q3. What non-punitive alternatives exist, and how do comparable apps handle streaks?

### Takeaway

The evidence-aligned option is a non-resetting consistency display: "X of 7 days logged this week" plus a calendar heatmap. It should be opt-in, have no "longest streak" leaderboard, allow backfilling, and stay hidden under the ED exclusion. Vendor practice ranges from hard streaks (Cronometer) to no streaks (MacroFactor's adherence-neutral design philosophy has not been verified; see Gaps).

### Cited Findings

- Cronometer: a streak of consecutive days with food logged. — [Cronometer blog](https://cronometer.com/blog/new-feature-streaks)
- Practitioner guidance: grace periods, backfill and flexible cut-off times reduce anxiety, while strict midnight resets and guilt-based notifications increase it. **Weak.** — [MyFoodBuddy blog](https://foodbuddy.my/blog/how-streaks-keep-you-consistent-with-calorie-tracking-20260612)
- Duolingo's own fix for streak-loss churn was to add forgiveness (freezes) instead of a hard reset. **Weak.** — [Lenny's Podcast summary](https://www.getrecall.ai/summary/lennys-podcast/behind-the-product-duolingo-streaks-or-jackson-shuttleworth-group-pm-retention-team)

### Inferences

- A suggested rewrite for #90: (a) a "Days logged: n/7 this week" chip and a 4–12 week consistency calendar, with no reset and no "longest streak"; (b) off by default, or shown neutrally only on the diary screen; (c) hidden when hide-numbers mode or an ED exclusion is on; (d) no push notifications that mention a missed day; (e) backfilled days count. "Retention lever" claims should be removed from the ticket rationale.

### Gaps

- I did not verify current streak behaviour in MyFitnessPal, Finch (widely described as non-punitive, with a pet that "rests" rather than dies, but unverified), Bearable, or MacroFactor's documentation. Check their help centres before citing them.

---

## Q4. How variable are real menstrual cycles, and are fixed-day phase rules valid?

### Takeaway

Fixed day ranges (1–5 / 6–14 / 15–17 / 18+) are not physiologically valid for most cycles. The follicular phase varies widely and ovulation day cannot be reliably inferred from the calendar alone (Strong).

### Cited Findings

- Bull et al. 2019 (_npj Digital Medicine_, Natural Cycles users): 612,613 ovulatory cycles from 124,648 users. Mean cycle length was 29.3 days. Mean follicular phase was 16.9 days (95% CI 10–30) and mean luteal phase was 12.4 days (95% CI 7–17). Ovulation was detected using basal body temperature (BBT) and luteinising hormone (LH) data. Follicular length fell by 0.19 days per year of age between 25 and 45. Even among 28-day cycles, the luteal phase ranged from 7 to 19 days. Clinical teaching assumes a 14-day luteal phase, but the real variation is much wider. **Strong (very large dataset; caveat: app users, possible selection bias).** — [Nature npj Digit Med](https://www.nature.com/articles/s41746-019-0152-7); [PMC6710244](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6710244/)
- The FDA classifies software that tells fertile from non-fertile days as a Class II device ("software application for contraception"). Natural Cycles' algorithm needs daily BBT and menstrual data, not calendar days alone. — [FDA DEN170052 decision summary](https://www.accessdata.fda.gov/cdrh_docs/reviews/DEN170052.pdf)

### Inferences

- With a 95% follicular range of 10–30 days, a "day 15–17 = ovulatory" label is often wrong by a week or more. Any phase label in openhealth should be (a) counted back from the next period (luteal ≈ the last ~12–14 days), (b) shown only after the next period is logged, or (c) marked "estimated" with low confidence. That fits the repo rule to "prefer deterministic summaries and explicit confidence/readiness signals". Phases should never be described as ovulation detection.
- Hormonal contraception, perimenopause, PCOS, postpartum status and breastfeeding all break phase logic. The ticket should let users set "no natural cycle / hormonal contraception" so that phase derivation is suppressed.

### Gaps

- I could not retrieve the full text for the share of cycles that are exactly 28 days or for within-person variability figures. Use the PMC full text to confirm.

---

## Q5. Does energy or protein need change across the cycle, are phase-based macro deltas evidence-backed, and what does MacroFactor actually do?

### Takeaway

Resting metabolic rate (RMR) rises slightly in the luteal phase, roughly 30–120 kcal/day (about 3–5%), with high heterogeneity, and the effect is smaller in recent, better-controlled studies (Moderate). No guideline supports set "+150 kcal / +10 g protein luteal" or "+50 kcal menstrual" deltas. **MacroFactor does not adjust calories or macros by cycle phase.** Its period tracking is "purely for personal reference". The ticket's claim that it is "matching MacroFactor" is false.

### Cited Findings

- Benton, Hutchins & Dawes 2020 (_PLOS ONE_ 15(7):e0236025), a systematic review and meta-analysis: small significant effect favouring higher RMR in the luteal phase (ES=0.33). In studies since 2000 the effect was smaller and non-significant (ES=0.23). Risk of bias in cycle-phase and RMR measurement, small samples. **Moderate.** — [PMC7357764](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7357764/)
- Hurtová, Gimunová & Beníčková 2026 (_Frontiers in Physiology_), a systematic review of 7 studies from 2020–2025: 5 of 6 comparisons found higher luteal RMR, about 30–120 kcal/day (about 3–5%). One study found +58 kcal/day in confirmed ovulatory cycles and +8 kcal/day in anovulatory ones. The authors say the shift "may overlap with typical day-to-day biological variability… or measurement error". They see possible relevance only for elite athletes or people at risk of low energy availability, and call for confirmed-ovulation designs before making recommendations. Samples ranged from n=7 to 38. **Moderate.** — [PMC13066135](https://pmc.ncbi.nlm.nih.gov/articles/PMC13066135/); [Frontiers](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2026.1778735/full)
- Energy intake: a narrative review in _Nutrition Reviews_ (2023) covers intake across the cycle. A 2025 study (Smith et al.) reports that energy intake and appetite "may be consistent across menstrual cycle phases" in lab and free-living conditions. I did not fetch either in detail. — [Nutrition Reviews 81(7):869](https://academic.oup.com/nutritionreviews/article/81/7/869/6823870); [Smith et al. 2025 PDF](https://waltersport.com/wp-content/uploads/2025/10/Energy-intake-and-appetite-in-laboratory-and-free-living-conditions-may-be-consistent-across-menstrual-cycle-phases-Smith-et-al.-2025.pdf)
- Protein: Wooding et al. 2017 (_Medicine & Science in Sports & Exercise_, n=6 active females, tested only in the luteal phase) estimated a protein requirement of 1.41 g/kg/d (EAR) and 1.71 g/kg/d (RDA) after variable-intensity exercise. It did not compare phases. An older study reported that cycle phase affects lysine requirement. A clinical trial on leucine requirement across the cycle is registered (NCT06533501), which shows the question is still open. **Weak for phase-specific protein deltas.** — [PubMed 28692631](https://pubmed.ncbi.nlm.nih.gov/28692631/); [Am J Physiol Endocrinol Metab (lysine)](https://journals.physiology.org/doi/full/10.1152/ajpendo.00262.2003); [NCT06533501](https://clinicaltrials.gov/study/NCT06533501)
- MacroFactor help centre: "For now, tracking your period in MacroFactor is purely for personal reference." The app says it plans future analytics and insights. Period tracking can be turned on or off under More → Data Visibility → Period Visibility. — [MacroFactor: Track Your Period](https://help.macrofactorapp.com/en/articles/17-track-your-period)
- Secondary reviews say MacroFactor does not adjust calorie recommendations by cycle. Its stated roadmap is to account for cycle-related **weight fluctuations** in the weight trend, not to change intake targets. **Weak (third-party review).** — [Outlift review (2026)](https://outlift.com/macrofactor-review/)

### Inferences

- A luteal increase of about 30–120 kcal is within the error of intake logging and of adaptive expenditure estimates. Fixed deltas would add precision the evidence does not support, and they would rest on calendar phases that are often wrong (see Q4).
- A defensible option for #91: no automatic macro deltas. Optionally (a) overlay periods on the weight-trend and intake charts so users can see their own patterns, and (b) add a neutral note that some people see slightly higher hunger or energy needs before a period, with no numeric target change. If any delta ships, it should be opt-in, user-entered (not app-prescribed), and disabled under the ED exclusion and hide-numbers mode.

### Gaps

- No meta-analysis directly measures luteal versus follicular energy intake or total daily energy expenditure in free-living conditions. Benton covers RMR only.
- No dated statement from MacroFactor confirms whether the weight-trend cycle feature has shipped as of October 2026.

---

## Q6. When does cycle tracking become a regulated medical device?

### Takeaway

Cycle logging and period prediction for wellness can stay unregulated. Claims about fertility status, contraception, or conception guidance make the software a medical device: FDA Class II (Natural Cycles De Novo; Clue Birth Control 510(k)) and very likely a device under EU MDR. openhealth should avoid any "fertile window" or "safe day" output.

### Cited Findings

- FDA De Novo DEN170052 (Natural Cycles, 2018) created the "software application for contraception" type (product code PYT, Class II). It covers software that gives user-specific fertility information to prevent pregnancy by analysing data such as temperature and cycle dates. Reported effectiveness: 93.5% typical use, 98.2% perfect use. — [FDA decision summary](https://www.accessdata.fda.gov/cdrh_docs/reviews/DEN170052.pdf); [FDA letter](https://www.accessdata.fda.gov/cdrh_docs/pdf17/DEN170052.pdf)
- Clue Birth Control received FDA clearance in March 2021 (92% typical, 97% perfect use). This shows that a mainstream period tracker becomes a regulated device once it adds a contraception claim. — [MobiHealthNews tag](https://www.mobihealthnews.com/tag/clue-birth-control); [NGP Capital](https://www.ngpcap.com/insights/clue-gets-fda-approval-for-digital-contraceptive)
- On January 6, 2026, the FDA finalised a revised guidance, "General Wellness: Policy for Low Risk Devices", replacing the 2019 version. Low-risk wellness products without diagnostic or treatment claims fall outside device regulation or under enforcement discretion. Products should avoid features that imply diagnosis, thresholds, or medical management. — [Troutman summary](https://www.troutman.com/insights/fdas-2026-guidance-on-general-wellness-devices-policy-for-low-risk-devices/); [FDA town hall page](https://www.fda.gov/medical-devices/medical-devices-news-and-events/town-hall-general-wellness-policy-low-risk-devices-final-guidance-02112026)

### Inferences

- Safe wellness scope: logging period days, flow and symptoms; showing past cycle lengths; predicting the next period start with uncertainty. Avoid: fertile-window or ovulation predictions presented as actionable, contraception or conception claims, and flags for "irregular cycle → see doctor" that work like diagnostic thresholds. Neutral educational text is lower risk.

### Gaps

- I did not retrieve EU MDR primary text or MDCG guidance. My understanding, unverified here, is that MDR Rule 11 software and contraception-purpose software is a medical device; Natural Cycles is CE-marked in the EU. Confirm the class from Natural Cycles' or the notified body's documents.

---

## Q7. How sensitive is reproductive health data, and which privacy safeguards should apply?

### Takeaway

Reproductive data is the most legally exposed category in this app. In the US there is FTC enforcement (Flo, Premom), a 2025 jury verdict against Meta over Flo SDK data, Washington's My Health My Data Act (MHMDA) with consent separate from other agreements, and post-Dobbs subpoena risk. In the EU it is GDPR Article 9 special-category data. Best-practice apps (drip., Apple) keep data on the device or end-to-end encrypted. A self-hosted app should put cycle data behind a separate consent and keep it out of AI, coach, analytics and exports by default.

### Cited Findings

- FTC v. Flo Health (final order June 2021): Flo shared health data from millions of users with Facebook, Google and others despite promising privacy. The order requires affirmative consent before sharing, an independent privacy review, notice to users, and instructions to third parties to destroy the data. — [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2021/06/ftc-finalizes-order-flo-health-fertility-tracking-app-shared-sensitive-health-data-facebook-google)
- FTC v. Easy Healthcare (Premom), May 2023: the FTC alleged that SDKs shared health data with third parties. The order imposed a $100,000 civil penalty under the Health Breach Notification Rule (HBNR) and a permanent ban on sharing health data for advertising. — [WilmerHale summary](https://www.wilmerhale.com/en/insights/blogs/wilmerhale-privacy-and-cybersecurity-law/20230525-ftc-brings-second-enforcement-action-against-healthcare-company-for-violating-the-health-breach-notification-rule)
- The HBNR was amended in 2024 (Federal Register, May 30, 2024) to state explicitly that it covers health apps, and an unauthorised disclosure counts as a "breach". — [Federal Register](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule)
- Frasco v. Flo Health: on August 1, 2025, a San Francisco federal jury found Meta liable under the California Invasion of Privacy Act (CIPA) for capturing reproductive health data through its SDK in Flo. Post-trial motions to set the verdict aside were denied, and Meta is appealing. — [Healthcare IT News](https://www.healthcareitnews.com/news/jury-finds-meta-liable-reproductive-health-data-case); [CIPAworld (Sept 2025)](https://cipaworld.com/2025/09/22/verdict-intact-metas-post-trial-attempts-to-avoid-liability-in-massive-cipa-ruling-fall-flat-as-court-refuses-to-decertify-class-and-set-aside-jury-finding/)
- Washington MHMDA: covers reproductive and sexual health information. Collecting and sharing each need their own consent, unless necessary to provide the service the consumer asked for. Consent must be opt-in, specific, and kept apart from other agreements. Selling data needs a signed authorisation. — [FPF policy brief](https://fpf.org/wp-content/uploads/2023/04/FPF-Legislation-Policy-Brief_-The-Washington-My-Health-My-Data-Act-Public-Version.pdf); [Cooley FAQ](https://cdp.cooley.com/washington-states-my-health-my-data-act-faq-part-two-requirements/)
- GDPR Article 9: "data concerning health" and data about a person's "sex life" are special categories that need an Article 9(2) basis, typically explicit consent. — [GDPR (EUR-Lex)](https://eur-lex.europa.eu/eli/reg/2016/679/oj)
- drip. (Heart of Code e.V., GPL-3.0, on F-Droid): open source, all data stays on the device, and the developers collect none. It uses the sympto-thermal method. — [drip. site](https://bloodyhealth.gitlab.io/); [F-Droid](https://f-droid.org/en/packages/com.drip/)
- Apple Cycle Tracking: with two-factor authentication on, Health data synced to iCloud is end-to-end encrypted, and Apple cannot read it. — [Apple Support: health records privacy](https://support.apple.com/en-us/111755); [Apple Platform Security](https://support.apple.com/en-eg/guide/security/sec88be9900f/web)

### Inferences

- Self-hosting lowers the risk from third-party SDKs and ad tech, but not legal-process risk. Whoever runs the server can be subpoenaed, and on shared or organisation instances other members may get access. Recommended safeguards for #91:
  1. A separate opt-in "Cycle tracking" toggle with its own consent record, kept apart from general nutrition consent.
  2. Excluded by default from AI and coach context, analytics or telemetry, Telegram and email messages, and clinical, CSV and PDF exports, with per-export opt-in.
  3. Hard delete of all cycle data plus an audit-log entry, with a "turn off and erase" flow.
  4. Strict organisation and tenant scoping. Caregiver or shared-org members get no visibility by default.
  5. Optionally, client-side-only or encrypted-at-rest storage so the server operator cannot read entries.
  6. No third-party SDKs on cycle screens.
  7. No "fertile window" output (see Q6).
- These are design recommendations derived from the enforcement pattern, not legal advice.

### Gaps

- I did not retrieve Euki's or Clue's current privacy documentation (Clue publicly states it is based in Germany and under GDPR, but this was not verified here), or an EDPB opinion specific to cycle data.
- Whether MHMDA applies to a self-hosted AGPL instance depends on who the "regulated entity" is (likely the operator, not the software author). This is unresolved.

---

## Q8. Can openhealth import cycle data from HealthKit or Health Connect instead of asking users to re-enter it?

### Takeaway

Yes. Both platforms expose menstruation types, so the existing Android Health Connect companion can import periods and flow, provided a separate read permission and opt-in are in place.

### Cited Findings

- Health Connect has a `MenstruationFlowRecord` (instantaneous; flow levels spotting, light, medium, heavy) and a `MenstruationPeriodRecord` (interval, start and end). Both need `android.permission.health.READ_MENSTRUATION` / `WRITE_MENSTRUATION`. There is also an `OvulationTestRecord` (positive / high / negative / inconclusive). — [Android MenstruationFlowRecord ref](https://developer.android.com/reference/android/health/connect/datatypes/MenstruationFlowRecord); [Health Connect data types](https://developer.android.com/health-and-fitness/health-connect/data-types)
- HealthKit has `HKCategoryTypeIdentifier.menstrualFlow` (plus ovulation-test results). It has no period-interval type, so periods must be inferred from flow samples. — [Apple developer: menstrualFlow](https://developer.apple.com/documentation/healthkit/hkcategorytypeidentifier/menstrualflow); [lunarlog issue (secondary)](https://github.com/wjdavis5/lunarlog/issues/202)

### Inferences

- Import is cheaper than manual entry and keeps provenance (the source app recorded in record metadata). The menstruation permission should be requested only after the user enables cycle tracking, not bundled into the general Health Connect permission prompt.

### Gaps

- I did not verify whether newer HealthKit versions add intermenstrual bleeding or other cycle-factor types, or whether Health Connect has added cycle-related types in 2026. Check current SDK documentation.
