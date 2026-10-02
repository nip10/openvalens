# Change detection in one person's self-tracked and wearable health data: signal or noise?

Scope: statistical and methodological basis for deterministic "insight" rules in openhealth (adults 18+, general wellness, no diagnosis). Notification timing, frequency and engagement are out of scope; another researcher covers them. Research date: October 2026. Evidence type and population are given for each claim. Several primary PDFs (Hopkins 2000, Mohammed 2008, the Nature step-count paper, Plews 2013 Sports Med full text) could not be fetched in full (paywall, bot-check or binary PDF). Where a claim depends only on a search-result snippet or an abstract, it is marked **[snippet/abstract only]**.

## Q1. Smallest worthwhile change (SWC), typical error, and personal baselines

### Takeaway

The sports-science approach is to compare an observed change with two things: the measurement noise (typical error, or within-person CV) and a smallest worthwhile change (SWC). It also prefers rolling averages over single days, because single-day resting HRV and HR are noisy (CV about 10–12%). These numbers come mostly from athletes measured under standardized morning conditions. Applying them to passive wearable data from general adults is an extrapolation.

### Cited Findings

- Hopkins (2000), "Measures of Reliability in Sports Medicine and Science", _Sports Medicine_ 30(1):1–15 (narrative/methods review). It defines the typical (standard) error of measurement as the standard deviation of an individual's repeated measurements, which is within-subject random variation. It names within-subject variation, systematic change in the mean, and retest correlation as the main reliability measures. — [Springer](https://link.springer.com/article/10.2165/00007256-200030010-00001); [Hopkins PDF](https://www.sportsci.org/resource/stats/Hopkins_SportsMed_rely_00.pdf) **[abstract only; full PDF not parseable]**
- SWC conventions attributed to Hopkins: 0.2 × between-subject SD (Cohen's "small" effect) for group analyses, 0.3 × within-subject SD suggested for individual analyses. A measure can detect the SWC only if its typical error is smaller than the SWC. — [Science for Sport (secondary)](https://www.scienceforsport.com/smallest-worthwhile-change/); [PMC5969020](https://pmc.ncbi.nlm.nih.gov/articles/PMC5969020/) **[snippet only; secondary]**
- Buchheit (2014), "Monitoring training status with HR measures: do all roads lead to Rome?", _Frontiers in Physiology_ 5:73, doi:10.3389/fphys.2014.00073 (narrative review, athletes). It reports these typical errors (CV): resting HR about 10%, resting Ln rMSSD about 12%, LF/HF about 80%, submaximal exercise HR about 3%, HR recovery about 25–35%, and exercise HRV about 60–150%. — [Frontiers](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2014.00073/full)
- Buchheit 2014, approximate SWCs: resting HR about −2%, resting HRV about +3%, exercise HR about −1%, HRR about +7%. SWC is commonly set at 0.5 or 1 × CV, but "there is currently no evidence that changes greater than any fraction of the CV would actually be meaningful in practice." — [Frontiers](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2014.00073/full)
- Buchheit 2014: individual changes should be interpreted against the error of measurement, the smallest important change and the training context. He recommends collecting HRV at least 3–4 times per week and averaging. "Increasing measurement frequency allows defining more accurately the normal ranges of individual variations and decreases the noise of measurement." — [Frontiers](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2014.00073/full)
- Plews et al. (2012), _Eur J Appl Physiol_, doi:10.1007/s00421-012-2354-4. This is a case comparison of 2 elite triathletes, so n=2. It used a 7-day rolling average of Ln rMSSD and its CV. In the athlete who became non-functionally over-reached, the CV of the 7-day rolling Ln rMSSD fell steadily (−0.65%/week). In the control athlete it stayed stable (0.04%/week). The authors conclude that both the trend and the day-to-day variation may matter. — [Springer](https://link.springer.com/article/10.1007/s00421-012-2354-4) **[abstract/snippet]**
- Plews et al. (2013), "Training Adaptation and Heart Rate Variability in Elite Endurance Athletes: Opening the Door to Effective Monitoring", _Sports Medicine_, doi:10.1007/s40279-013-0071-8. This is the review behind the "7-day rolling average plus CV" monitoring approach. — [Springer](https://link.springer.com/article/10.1007/s40279-013-0071-8) **[full text not retrieved; exact recommendations not verified]**
- Quer et al. (2020), _PLOS ONE_, doi:10.1371/journal.pone.0227709. Retrospective cohort of 92,457 Fitbit users and about 33M person-days (general adults, not athletes). The mean within-individual SD of daily RHR was about 3.0 bpm (3.10 women, 2.90 men). Median weekly fluctuation was about 3 bpm, and about 80% of people had a maximum weekly change under 10 bpm. Mean RHRs differed between individuals by as much as 70 bpm (range 40–109). Their deviation rule was RHR more than 2 SD above the mean of the previous 20 measurements, for at least 3 measurements within 5 days. — [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0227709)

### Inferences

- A defensible rule pattern for openhealth has three parts:
  - A **personal baseline** of the trailing N days (Quer used 20 readings; sports science typically uses about 4–8 weeks of data).
  - A **current window** of a 7-day rolling mean, not a single day.
  - A **threshold** stated in personal SD units or as a % CV. Only flag when the rolling mean exceeds both the noise band and a practical-importance floor (SWC).
- Quer's within-person SD of about 3 bpm is a good default noise estimate for "resting HR trending up" in general adults. A 7-day mean rise of about 3 bpm or more (roughly 1 SD of daily values, and well above the SE of a 7-day mean of about 1.1 bpm) is a plausible starting threshold. This must be validated, not assumed.
- Buchheit's resting-HR CV of about 10% comes from standardized athlete spot measurements. Wearable-derived nightly RHR (Quer: SD about 3 bpm on a mean of 65, roughly 4.6%) appears less noisy. Device-specific error should be estimated from each user's own data rather than copied from the athlete literature.
- SWC values for wellness outcomes are not established. Rules should claim "different from your usual", not "meaningful for your health".

### Gaps

- No validated SWC exists for general-adult wearable RHR, HRV, sleep or steps in terms of health outcomes. The SWC literature is anchored in performance.
- Hopkins 2000 full text and Plews 2013 Sports Med full text were not retrieved, so their exact numerical recommendations are unverified here.
- No head-to-head study was found comparing a 30-day vs 60-day baseline window in consumer wearables.

## Q2. Reliable Change Index (Jacobson & Truax 1991)

### Takeaway

The RCI tests whether a two-time-point difference exceeds what measurement error alone would produce at roughly p<0.05. Its arithmetic fits an "is this week different from my baseline?" check. But it was designed for pre/post psychometric scores, it ignores regression to the mean, and it does not handle dense time series well.

### Cited Findings

- Jacobson & Truax (1991), _J Consult Clin Psychol_ 59(1):12–19. The paper proposed the RC index to judge whether an individual's change is statistically greater than random measurement error, alongside a clinical-significance cutoff. — [PDF](https://sciences.ucf.edu/psychology/childrenslearningclinic/wp-content/uploads/sites/24/2013/08/Truax-Jacobson-pdf.pdf); [PubMed 1619094 (revisit)](https://pubmed.ncbi.nlm.nih.gov/1619094/)
- Formula, from Blampied (2022), _The Cognitive Behaviour Therapist_ 15:e50, a methods review:
  - SEM = SD × √(1 − r_xx)
  - S_diff = √(2·SEM²)
  - Change is "reliable" if |Δ| / S_diff > 1.96
  - Test-retest reliability over a short interval was the original recommendation. Many studies substitute Cronbach's α.
  - Limitations: regression to the mean, practice effects, only two time points, and SEM that depends on context.
  - [Cambridge](https://www.cambridge.org/core/journals/the-cognitive-behaviour-therapist/article/reliable-change-and-the-reliable-change-index-still-useful-after-all-these-years/75AC9F09E738AC53924DA77AE4C66D7D)
- RCI operationalization is inconsistent. A review of clinical psychology trials found at least 7 distinct operationalizations, with threshold discrepancies of up to 79%. — [PubMed 42570335](https://pubmed.ncbi.nlm.nih.gov/42570335/) **[snippet only]**

### Inferences

- For wearables, the person's own repeated measurements give a direct within-person SD, so there is no need to borrow a population reliability coefficient. Comparing a 7-day mean with a baseline mean uses standard errors of means. This is closer to a two-sample comparison or a control chart than to a classical RCI.
- RCI-style language ("larger than your typical day-to-day variation") is an honest claim. "Clinically significant" is not justified for a wellness app.

### Gaps

- No studies were found that apply the RCI to consumer wearable time series.

## Q3. Statistical process control (Shewhart, CUSUM, EWMA) for individual patients

### Takeaway

SPC has been used both for healthcare improvement and directly on individual patients' clinical variables. Shewhart individuals (XmR) charts catch large shifts. EWMA and CUSUM catch small, sustained shifts. Extra run rules raise sensitivity but also raise false alarms. All of these methods assume independent observations, and autocorrelated daily wearable data violates that.

### Cited Findings

- Thor et al. (2007), _Qual Saf Health Care_ 16(5):387–399 (systematic review; 57 empirical studies, 1990–2004). SPC was applied across many settings, including "directly by patients", using 97 different variables. The review lists 11 approaches to smart application, including risk adjustment and data stratification. — [Ovid](https://www.ovid.com/journals/qsheca/abstract/00134255-200710000-00014~application-of-statistical-process-control-in-healthcare?redirectionsource=fulltextview); [Semantic Scholar](https://www.semanticscholar.org/paper/Application-of-statistical-process-control-in-Thor-Lundberg/8ddea25c22a0a84126b7650d81e952084b8f651c)
- Tennant, Mohammed, Coleman & Martin (2007), _Int J Qual Health Care_ 19(4):187–194 (systematic review). Of 74 studies, 7 used control charts to monitor clinical variables in individual patients: hypertension, asthma, renal function after transplant, and diabetes. Three assessed sensitivity and specificity against gold standards, with moderate samples (n = 35–45). — [NCBI Bookshelf DARE](https://www.ncbi.nlm.nih.gov/books/NBK74277/); [Birmingham](https://research.birmingham.ac.uk/en/publications/monitoring-patients-using-control-charts-a-systematic-review/)
- XmR (individuals) chart limits: mean ± 2.66 × mean moving range, because sigma ≈ MR̄/1.128 and 3/1.128 ≈ 2.66. — [analyse-it docs](https://analyse-it.com/docs/user-guide/process-control/shewhart-control-chart-rules); tutorial: Mohammed et al. 2008, "Plotting basic control charts: tutorial notes for healthcare practitioners" ([PDF](https://qi.elft.nhs.uk/wp-content/uploads/2018/10/Mohammed-et-al-2008-Plotting-basic-control-charts.pdf)) **[snippet; PDF text not extractable]**
- Supplementary run rules (WECO/Nelson) improve sensitivity to small and moderate shifts, but significantly raise the false-alarm rate, which lowers the in-control ARL. Combining Shewhart and EWMA charts is encouraged in healthcare. — [ResearchGate: Shewhart with supplementary runs rules](https://www.researchgate.net/publication/225775194_Statistical_Process_Control_using_Shewhart_Control_Charts_with_Supplementary_Runs_Rules); [analyse-it](https://analyse-it.com/docs/user-guide/process-control/shewhart-control-chart-rules) **[snippet]**
- Traditional Shewhart and CUSUM charts assume independent observations. Their performance "deteriorates significantly under autocorrelation". One remedy is to fit a time-series model (e.g., AR(1)) and chart the residuals. — [J Quality Technology 2022, Phase I chart for autocorrelated individual data](https://www.tandfonline.com/doi/full/10.1080/00224065.2022.2139783) **[snippet]**

### Inferences

- Mapping onto openhealth rules:
  - "Sudden unusual day" → Shewhart/XmR-style outlier (e.g., beyond about 3 SD).
  - "Trending up/down" → EWMA of the daily value, or a one-sided CUSUM against the baseline mean with a reference value k ≈ 0.5 SD.
  - Reporting "shift" only after a run of several consecutive days on one side (as in Quer's 3-of-5 rule) is a cheap way to reduce single-day noise.
- Phase I/Phase II thinking applies. First establish a stable baseline (Phase I, with outlier days excluded), then monitor (Phase II). Re-baseline after a known structural change, such as a new device or a deliberate new training plan.

### Gaps

- No studies validate EWMA/CUSUM parameters (λ, k, h) for consumer-wearable RHR, sleep, steps or weight in general adults.

## Q4. N-of-1 time series: autocorrelation, weekday seasonality, regression to the mean

### Takeaway

Daily wearable series are autocorrelated and have strong weekly and annual cycles. Weekend effects are large for sleep (+20–35 min) and present for weight (+0.35%). A naive "today vs average" rule will fire predictably on Mondays, Sundays, in winter, and after holidays. Extreme days tend to regress toward the mean.

### Cited Findings

- Scott, Lechat, Sansom et al. (2025), _Sleep_ 48(9):zsaf099. About 73M nights from 116,879 adults using the Withings under-mattress sensor (77% male, mean age 49), 2020–2023:
  - Weekend sleep was 20–35 min longer than weekday sleep.
  - In the northern hemisphere (30–90° latitude), sleep was 15–25 min longer in winter.
  - Sleep-duration irregularity was about 8–12% higher in winter at higher latitudes.
  - [Sleep (OUP)](https://academic.oup.com/sleep/article/48/9/zsaf099/8112832)
- Turicchi et al. (2020), _PLOS ONE_, doi:10.1371/journal.pone.0232152. Adults in a European behavioural weight-loss-maintenance programme, weighing on a Fitbit Aria smart scale (n=1,421 for the weekly analysis):
  - Within-week weight swing was 0.35% of body weight, highest on Monday and lowest on Friday (men 0.41%, women 0.29%; about 0.3 kg).
  - The Christmas-period gain was 1.35% (SD 1.74), still at least 0.35% above the pre-Christmas weight in March.
  - Annual fluctuation was about 0.8%.
  - Methods: LOESS for detrending and EWMA for imputing missing data.
  - [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0232152)
- Orsama et al. (2014), "Weight Rhythms: Weight Increases during Weekends and Decreases during Weekdays", _Obesity Facts_ 7(1):36–47. This is the original weekly weight-rhythm observation. — cited in [Turicchi 2020](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7192384/) **[not directly fetched]**
- Quer 2020: population mean RHR shows about a 2 bpm annual cycle, peaking in early January and lowest in late July. — [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0227709)
- Regression to the mean is a recognised limitation of RCI-type individual-change methods: extreme baseline values tend to move back toward average at follow-up. — [Blampied 2022](https://www.cambridge.org/core/journals/the-cognitive-behaviour-therapist/article/reliable-change-and-the-reliable-change-index-still-useful-after-all-these-years/75AC9F09E738AC53924DA77AE4C66D7D)
- Autocorrelation degrades control-chart performance (see Q3). — [J Quality Technology 2022](https://www.tandfonline.com/doi/full/10.1080/00224065.2022.2139783)

### Inferences

- Comparisons should be weekday-matched ("this Monday vs your usual Mondays") or based on full 7-day windows, so the weekly cycle cancels out. A 7-day rolling mean removes most of the weekday effect by construction.
- Insight copy should avoid triggering on one extreme day followed by "improvement". The next day's apparent recovery is often just regression to the mean.
- Seasonal and holiday effects (winter sleep, January RHR, Christmas weight) are real and expected. A 60–90 day baseline will partly absorb them. Year-over-year comparisons become possible only after a full year of data.

### Gaps

- No quantitative estimates were found of lag-1 autocorrelation for consumer RHR, HRV, sleep or steps series.
- No source was found that quantifies weekday effects for steps in a large wearable sample. The weekday/weekend difference is mentioned but not quantified in the sources retrieved.

## Q5. Day-to-day biological variability of typical signals

### Takeaway

Typical within-person day-to-day variability, as relative noise, ranks roughly from lowest to highest: body weight (about 0.5–0.7% CV), resting HR (about 3 bpm SD in wearables; about 10% CV in athlete spot checks), HRV Ln rMSSD (about 12% CV), sleep duration (about 60–80 min SD, about 19% CV), steps (about 35–60% CV). Rules for noisy signals such as steps and sleep need longer windows and larger thresholds.

### Cited Findings

- **Resting HR, wearable, general adults:** within-person SD about 3.0 bpm; about 80% have a maximum weekly change under 10 bpm. — [Quer 2020 PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0227709)
- **Resting HR and HRV, athletes, standardized:** CV about 10% (RHR) and about 12% (Ln rMSSD). — [Buchheit 2014](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2014.00073/full)
- **Sleep duration:** a pooled analysis of 8 datasets (actigraphy) gave an intraindividual SD of 77.4 min, RMSSD of 108.9 min and CV of 19.1%. Diary measures were more variable (iSD 85.8 min). Estimating intraindividual variability reliably needs about 41–65 nights, whereas means stabilise with 2–7 nights. — [PMC9649840](https://pmc.ncbi.nlm.nih.gov/articles/PMC9649840/) **[snippet; PMC page bot-blocked]**
- In US adults and children (accelerometer), 43% had a sleep-duration SD of 60 min or more. — [Sci Rep 2023 (PMC10719297)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10719297/) **[snippet]**
- **Body weight, euvolemic healthy adults** (Ren Fail 2023, PMC10653631):
  - Day-to-day SD 0.53% at a 1-day interval, rising to 0.69% at a 7-day interval.
  - Other cited studies report CVs of 0.66 ± 0.24% (65 men aged 18–42) and 0.71% (10 adults), and about 0.4 kg variability over 5 consecutive days (86 male students).
  - [PMC10653631](https://pmc.ncbi.nlm.nih.gov/articles/PMC10653631/); [Tandfonline](https://www.tandfonline.com/doi/full/10.1080/0886022X.2023.2273421) **[snippet; full text blocked]**
- **Steps:** within-person CV of 0.355 in an aging cohort using commercial wearables (STRRIDE-PD). A systematic review found 2–5 days needed to estimate habitual steps in adults and 2–4 days in older adults. A 212,048-adult wrist-tracker and smartphone study used ICC ≥ 0.8 as its reliability criterion. — [PMC13228750](https://pmc.ncbi.nlm.nih.gov/articles/PMC13228750/); [Sci Rep 2021 (PMC8100112)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8100112/) **[snippets; Nature page redirected to login]**
- Among 26,935 connected-device users, those with step CV ≤ 40% lost 0.33 kg more over 6 months than those with CV ≥ 63%. This shows that inter-day step CVs of 40–63%+ are common. — [PubMed 33856352](https://pubmed.ncbi.nlm.nih.gov/33856352/) **[snippet; observational]**

### Inferences

- Approximate noise of a 7-day mean (SE ≈ SD/√7, ignoring autocorrelation, which inflates it):
  - RHR: about 1.1 bpm
  - Sleep: about 25–30 min
  - Weight: about 0.2% of body weight
- Some starting thresholds are therefore plausible: "sleep shorter than your usual" by ≥ 30–45 min on the 7-day mean, and "RHR up" by ≥ 3 bpm on the 7-day mean. Each also needs a persistence condition. These are engineering defaults, not evidence-validated cutoffs.
- Steps are so variable (CV about 35–60%) that "activity dropped" should compare weekly totals or 14-day means and require a large relative drop (e.g., ≥ 20–30%). This inference is not validated.

### Gaps

- No large general-adult study of consumer-wearable nightly HRV (rMSSD) within-person CV was retrieved. The 12% figure comes from athletes.
- Device-specific measurement error vs true biological variability is not separated in most wearable studies.

## Q6. Weight trend smoothing and plateau detection

### Takeaway

Daily weight noise (about 0.5–0.7% SD, plus a weekly cycle of about 0.35% and holiday spikes) is similar in size to a week of real change. Smoothing (EWMA or LOESS) and multi-week windows are therefore needed. EWMA and Kalman-type smoothers reconstruct smart-scale weight series well. No validated plateau-detection algorithm was found.

### Cited Findings

- In a smart-scale simulation and validation study, structural modelling with Kalman smoothing or an EWMA gave the best agreement with observed weights when imputing missing values (RMSE 0.62–0.64%). — [JMIR (PMC7519428)](https://pmc.ncbi.nlm.nih.gov/articles/PMC7519428/) **[snippet]**
- Turicchi 2020 used LOESS to extract weekly and seasonal patterns and EWMA to impute missing smart-scale data. — [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0232152)
- Day-to-day SD of weight was 0.53% (1-day interval) and 0.69% (7-day interval) in euvolemic adults. — [PMC10653631](https://pmc.ncbi.nlm.nih.gov/articles/PMC10653631/) **[snippet]**
- Weight follows a weekly rhythm (Monday peak) and Christmas gains of about 1.35%. — [Turicchi 2020](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0232152)

### Inferences

- Rule sketch for "weight plateau":
  - Fit a linear slope (or compare EWMA endpoints) over ≥ 3–4 weeks with ≥ 3 weigh-ins per week.
  - Call it a plateau if the slope's CI includes 0 and the absolute slope is below a practical floor (e.g., < 0.1% of body weight per week).
  - To call a trend, require the projected change over the window to exceed about 2 × the daily SD (about 1–1.5% of body weight).
  - These parameters are derived from the variability data above and are not validated.
- Weekday-matched comparisons ("Monday to Monday") or 7-day means avoid false "gain" signals caused by the weekend effect.

### Gaps

- No peer-reviewed study was found that validates a specific EMA smoothing factor (e.g., the popular 10%/day "Hacker's Diet" convention) or a plateau-detection rule. That convention is grey literature and was not verified here.

## Q7. Minimum data, missingness and device changes

### Takeaway

Means need only a few days (steps 2–5 days; sleep 2–7 nights; HRV at least 3 measurements per week to reflect the weekly mean). Estimating a person's variability, which the noise band depends on, needs much more: about 6–9 weeks for sleep. Device changes alter measurement properties and need a re-baseline.

### Cited Findings

- **HRV (athletes):** at least 3 (ideally random) LnRMSSD measures per week are needed to reflect the 7-day mean. Plews et al. 2014, "Monitoring Training With Heart-Rate Variability: How Much Compliance Is Needed for Valid Assessment?", _IJSPP_. — [ResearchGate](https://www.researchgate.net/publication/259319333_Monitoring_Training_With_Heart-Rate_Variability_How_Much_Compliance_Is_Needed_for_Valid_Assessment); [HRV4Training blog summary](https://hrvtraining.com/2014/01/29/hrv-measurement-frequency-comparing-3-day-to-7-day-per-week-recordings/) **[abstract/secondary]**
- **HRV (athletes):** Buchheit recommends at least 3–4 measures per week, averaged. — [Frontiers](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2014.00073/full)
- **Sleep:** means need 2–7 nights; intraindividual variability needs about 41–65 nights. — [PMC9649840](https://pmc.ncbi.nlm.nih.gov/articles/PMC9649840/) **[snippet]**
- **Steps:** 2–5 days for adults (systematic review, ICC ≥ 0.8). — [PMC8100112](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8100112/) **[snippet]**
- **RHR baseline (wearable cohort):** the previous 20 measurements; the cohort was restricted to people wearing the device ≥ 2 days/week, ≥ 20 h/day, for ≥ 35 weeks. — [Quer 2020](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0227709)
- **Device differences:** a 2025 systematic review and network meta-analysis compared daily step counts across wearable devices in free-living adults, which implies counts differ systematically by device. — [PubMed 42492741](https://pubmed.ncbi.nlm.nih.gov/42492741/) **[title/snippet only; effect sizes not retrieved]**
- **Device computation:** wearable RHR is computed by proprietary formulas. Fitbit, for example, estimates a "supine, just after waking" equivalent. — [Quer 2020](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0227709)

### Inferences

- Suggested readiness gates:
  - For a rule to compare means: ≥ 14 valid days in the baseline and ≥ 4–5 valid days in the current 7-day window.
  - For a rule that relies on a personal SD band (e.g., sleep variability): ≥ 28–42 days.
  - Otherwise show "building your baseline". This fits the repo's "explicit confidence/readiness signals" principle.
- Valid-day definitions are needed: minimum wear hours for steps, a main sleep period present for sleep.
- Baselines should be keyed by source and device. When the source changes, start a new baseline and suppress trend rules until it reaches the readiness gate. Do not splice series from different devices.

### Gaps

- No direct evidence was found for how to calibrate across devices within one person, or for how long a re-baseline must run after a device switch.

## Q8. Multiple comparisons and false alarms with many daily rules

### Takeaway

Each rule run daily has a per-day false-positive rate. Across many rules and days, false alarms accumulate quickly. Run rules and 2-SD thresholds make this worse. The SPC literature handles it by trading sensitivity for in-control average run length (ARL). No consumer-wellness-specific evidence was found.

### Cited Findings

- Supplementary run rules raise false alarms and shorten the in-control ARL. — [ResearchGate](https://www.researchgate.net/publication/225775194_Statistical_Process_Control_using_Shewhart_Control_Charts_with_Supplementary_Runs_Rules); [analyse-it](https://analyse-it.com/docs/user-guide/process-control/shewhart-control-chart-rules) **[snippet]**
- Autocorrelation degrades the nominal false-alarm properties of standard charts. — [J Quality Technology 2022](https://www.tandfonline.com/doi/full/10.1080/00224065.2022.2139783) **[snippet]**
- Quer 2020 used 2 SD plus a persistence requirement (≥ 3 measurements within 5 days) rather than a single-day 2 SD trigger. — [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0227709)

### Inferences (arithmetic, assuming independence and normality, not empirical)

- A one-sided 2 SD daily trigger fires about 2.3% of in-control days, roughly once every 44 days per rule. With 10 rules, that is about one false alarm every 4–5 days per user.
- A 3 SD two-sided trigger fires about 0.27% of days (ARL ≈ 370). Persistence requirements (k-of-n days) and 7-day-mean inputs cut false alarms sharply. Autocorrelation partly offsets the benefit of 7-day means.
- Mitigations:
  - Use fewer, broader rules.
  - Combine a statistical threshold with a practical (SWC) floor.
  - Require persistence.
  - Add a cooldown or hysteresis after each rule fires, so a single episode yields one insight.
  - Simulate per-rule false-alarm rates on historical or synthetic data before shipping.
  - Show the observed difference and the "usual range" rather than a binary verdict.

### Gaps

- No studies were found that measure false-alarm burden or alert fatigue for consumer wellness insight engines. That belongs partly to the engagement researcher's scope.
- No guidance was found on formal FDR control (e.g., Benjamini–Hochberg) for per-user daily rule sets in wellness apps.
