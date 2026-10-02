# Population reference datasets for "people your age/sex" benchmarks (openhealth)

Scope: which reference distributions could honestly back age×sex percentile comparisons for adults (18+) using wearable or manually entered values. Covers dataset, method, population, year, license, and comparability. It does not cover the psychology of comparisons or community aggregation privacy, which another researcher owns.

Research limits: about 16 tool calls. Some publisher pages (Lancet, Mayo Clinic Proceedings) returned HTTP 403, and the NCHS resting-pulse PDF could not be parsed locally because no PDF text tool was available. Claims from those sources rest on search-result abstracts and are marked that way. Any number not traced to a primary source is flagged.

## Q1. Which datasets give age×sex percentiles (p10–p90) usable without fabrication, and which give only recommendations or means?

### Takeaway
Only a few sources publish real age×sex percentile tables for adults. They are NCHS/NHANES reports (resting pulse, anthropometrics including waist, and other body measures), NHANES-derived papers (grip strength, steps), Dodds 2014 (UK grip centiles), and the FRIEND registry (lab-measured VO2max percentiles by decade). The large wearable cohorts (Quer 2020 RHR, Natarajan 2020 HRV, Fitbit sleep) report means or curves by age and sex, not reusable percentile tables. Nunan 2010 HRV gives a pooled mean and a range across studies, not percentiles. Sleep guidelines (AASM/SRS, NSF) are recommendations, not distributions.

### Cited Findings

**Resting heart rate**
- NCHS National Health Statistics Report No. 41 (Ostchega et al., 24 Aug 2011), "Resting Pulse Rate Reference Data for Children, Adolescents, and Adults: United States, 1999–2008". It presents national reference data on resting pulse rate for all ages. 49,114 people were examined, and a normative sample of 35,302 was identified. Evidence type: US nationally representative survey (NHANES), government report. — [CDC NCHS PDF](https://www.cdc.gov/nchs/data/nhsr/nhsr041.pdf); [NTIS record](https://ntrl.ntis.gov/NTRL/dashboard/searchResults/titleDetail/PB2011114782.xhtml)
  - I could not extract the percentile set, the measurement protocol (NHANES palpated radial pulse while seated, per my prior knowledge, unverified in this pass), or the exclusion criteria from the PDF. See Gaps.
- Quer et al. 2020 (PLoS One). 92,457 de-identified US Fitbit users (all 50 states) who wore the device for at least 35 weeks, March 2016 to February 2018, with a median of 320 days of wear. Daily RHR comes from Fitbit's proprietary algorithm and is meant to approximate the supine value just after waking. Mean RHR was 65.5 ± 7.7 bpm, and individual means ranged from 39.7 to 108.6 bpm. Women's RHR was higher than men's at all ages. RHR rose until about age 50 and then declined. **The paper gives descriptive statistics by age and sex but no formal percentile tables.** License: Creative Commons Attribution. Evidence type: retrospective commercial-device cohort, not population-sampled. — [PLoS One](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0227709)

**HRV (RMSSD)**
- Nunan et al. 2010 (Pacing Clin Electrophysiol) is a quantitative systematic review of 44 studies (21,438 participants) of short-term HRV in healthy adults, published 1997 to Sept 2008. Mean short-term RMSSD was 50 ms, with a range of 19–75 ms across 15 studies. Values were lower than Task Force norms, and the authors flagged inconsistent RR editing methods. **This is a pooled mean and between-study range, not age×sex percentiles.** — [Wiley](https://onlinelibrary.wiley.com/doi/10.1111/j.1540-8159.2010.02841.x); [Essex repository](https://repository.essex.ac.uk/943/)
- Natarajan et al. 2020 (Lancet Digital Health 2(12):e650–e657). Cross-sectional study of 8,203,261 Fitbit users, using interbeat-interval data from one randomly selected 24-h period (data collected 1 Sep 2018). HRV metrics fell with age, and parasympathetic measures fell faster than sympathetic ones. SDRR, LF power and Poincaré S2 differed by sex. **RMSSD, HF power and Poincaré S1 showed no comparable sex difference.** The authors were at Fitbit, according to the author list and affiliations reported in search results. — [Lancet Digital Health](https://www.thelancet.com/journals/landig/article/PIIS2589-7500(20)30246-6/fulltext); [bioRxiv preprint](https://www.biorxiv.org/content/10.1101/772285v1.full.pdf); [MobiHealthNews summary](https://www.mobihealthnews.com/news/fitbit-study-finds-heart-rate-variability-fluctuates-age-gender-time-day-and-activity-level)
  - I could not confirm whether the paper has extractable percentile tables (rather than figures) or what its license is (the publisher page returned 403).
- An aggregator search snippet cited "published reference data from 1,906 healthy adults using clinical ECG (5 min lying down)", with mean RMSSD 42.9 ms (women) and 39.7 ms (men) at ages 25–34, falling to 19.1 ms at 65–74. **The snippet named no primary source.** It is probably Voss et al. 2015 (PLoS One), but I did not verify that. Do not use these numbers until the primary source is checked. — [search snippet via longevity-germany.com / similar](https://longevity-germany.com/en/guide/hrv-normwerte-tabelle)
- A ResearchGate preprint claims "normal reference values of HRV for short-term recordings… obtained on wearable smart devices (smart watches, bracelets, rings)" by age, sex, activity and race. It has not been peer-review verified, and its provenance is unclear. — [ResearchGate](https://www.researchgate.net/publication/393471933_Normal_reference_values_of_heart_rate_variability_HRV_for_short-term_recordings_of_R-R_intervals_by_age_group_gender_physical_activity_race_obtained_on_wearable_smart_devices_smart_watches_smart_brace)
- Consumer blog "HRV by age" percentile charts (Welltory, BodySpec and others) quote p10/p50/p90 values (for example, men 18–24 at p50 = 46 ms) without a traceable primary dataset. **Low trust; do not use.** — [Welltory](https://welltory.com/blog/what-is-a-good-hrv-range); [BodySpec](https://www.bodyspec.com/blog/post/understanding_heart_rate_variability_by_age)

**VO2max / cardiorespiratory fitness**
- FRIEND registry: Kaminsky et al. 2022, "Updated Reference Standards for Cardiorespiratory Fitness Measured with Cardiopulmonary Exercise Testing", Mayo Clin Proc 97(2):285–293. VO2max percentiles for apparently healthy US men and women by decade from age 20 to 79, reported separately for treadmill and cycle ergometer. Evidence type: multi-site US lab registry of directly measured CPX (gas exchange), a convenience sample. — [Mayo Clin Proc](https://www.mayoclinicproceedings.org/article/S0025-6196(21)00645-5/fulltext)
- Related FRIEND papers: cycle ergometry reference standards (Mayo Clin Proc, about 2017) — [George Fox digital commons](https://digitalcommons.georgefox.edu/hhp_fac/9/); global reference standards — [Mayo Clin Proc 2019 abstract](https://www.mayoclinicproceedings.org/article/S0025-6196(19)30629-9/abstract); reference standards by CVD category and modality — [PubMed 34747182](https://pubmed.ncbi.nlm.nih.gov/34747182/).
- One secondary source says the 2022 update lowered treadmill medians by 1.5–4.6 ml/kg/min compared with 2015. **This is from an aggregator, not verified against the paper.** — [afasteryou.com](https://afasteryou.com/blog/en/vo2max-table/)

**Steps**
- Tudor-Locke et al. (Med Sci Sports Exerc 2009), "Accelerometer-Determined Steps per Day in US Adults". NHANES 2005–2006, 3,744 adults aged 20+ wearing hip ActiGraph monitors. Mean was 9,676 ± 107 uncensored steps/day, or 6,540 ± 106 steps/day after censoring steps below 500 counts/min. — [ResearchGate](https://www.researchgate.net/publication/26282350_Accelerometer-Determined_Steps_per_Day_inUS_Adults); [Ovid/MSSE](https://www.ovid.com/jnls/acsm-msse/abstract/10.1249/mss.0b013e318199885c~accelerometer-determined-steps-per-day-inus-adults?redirectionsource=fulltextview)
- Tudor-Locke et al. 2013 (J Gerontol A), "Normative Steps/Day Values for Older Adults: NHANES 2005–2006". 1,196 adults aged 60+, with quintile-defined steps/day for age bands 60–64 through 85+, by sex. The highest category was men 65–69 (>9,126 steps/day) and the lowest was women 85+ (<276 steps/day). Smoothed p5/p25/p50/p75/p95 curves are reported. — [PubMed 23913932](https://pubmed.ncbi.nlm.nih.gov/23913932/); [OUP PDF](https://academic.oup.com/biomedgerontology/article-pdf/68/11/1426/1736059/glt116.pdf)
- Newer NHANES 2011–2014 wrist accelerometry provides raw data from which step counts can be derived. Step-counting algorithms for these data are still being compared, so no single canonical steps/day distribution exists yet. — [arXiv 2410.11040](https://arxiv.org/html/2410.11040v1)

**Sleep duration**
- Fitbit regional study: 553,559 nights from 23,680 Fitbit users aged 15–80. Women slept more than men, and older users slept less than younger ones. The data are reported as group comparisons, not public percentile tables. — [PMC6399225](https://pmc.ncbi.nlm.nih.gov/articles/PMC6399225/)
- All of Us: 8,563 participants with Fitbit sleep data and EHR records (median 4.2 years of monitoring, median age 55). Total, deep and REM sleep declined with age and were longer in XX than in XY participants. — [JMIR 2025](https://www.jmir.org/2025/1/e71718); [PMC12597665](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12597665/)

**Grip strength**
- Dodds et al. 2014 (PLoS One 9(12):e113637, DOI 10.1371/journal.pone.0113637), "Grip Strength across the Life Course: Normative Data from Twelve British Studies". 60,803 observations from 49,964 participants, giving cross-sectional centile curves across the life course. Weak grip (≥2.5 SD below the sex-specific peak mean) reached 23% prevalence in men and 27% in women by age 80. Evidence type: pooled UK cohorts. PLoS One is open access (CC BY is PLoS's standard license, but I did not check it on this specific article). — [PubMed 25474696](https://pubmed.ncbi.nlm.nih.gov/25474696/); [Glasgow eprint](http://eprints.gla.ac.uk/100641/1/100641.pdf)
- Wang, Bohannon et al. 2018 (JOSPT), "Hand-Grip Strength: Normative Reference Values and Equations for Individuals 18 to 85 Years of Age Residing in the United States". NHANES 2011–2014, with summary statistics including percentiles. Mean grip ranged from 49.7 kg (dominant hand, men 25–29) to 18.7 kg (non-dominant hand, women 75–79). — [JOSPT](https://www.jospt.org/doi/abs/10.2519/jospt.2018.7851); [Semantic Scholar](https://www.semanticscholar.org/paper/Hand%E2%80%90Grip-Strength:-Normative-Reference-Values-and-Wang-Bohannon/0e17fd96cf5882725c35bd334ec0631b2259a7df)
- Summary of NHANES 2011–2014 grip measurements: 13,676 participants aged 6–80. — [J Hand Therapy](https://www.jhandtherapy.org/article/S0894-1130(17)30389-7/abstract)
- German normative handgrip values by sex, age and body height (PLoS One 2016) are an alternative European reference. — [PLoS One](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0163917)

**Body measures (waist, BMI, weight)**
- NCHS Vital Health Stat Series 3 No. 46, "Anthropometric Reference Data for Children and Adults: United States, 2015–2018" (Jan 2021). Gives N, mean, SE and selected percentiles of weight, height, circumferences (including waist) and other measures, by sex, age and race/Hispanic origin. — [CDC PDF sr03-046](https://www.cdc.gov/nchs/data/series/sr_03/sr03-046-508.pdf)
- There is a newer edition covering NHANES August 2021–August 2023 (Series 3 No. 50). — [NCBI Bookshelf NBK620760](https://www.ncbi.nlm.nih.gov/books/NBK620760/); [CDC PDF sr03-050](https://www.cdc.gov/nchs/data/series/sr_03/sr03-050.pdf)
- Earlier edition (Series 3 No. 39, 2007–2010). — [CDC PDF](https://www.cdc.gov/nchs/data/series/sr_03/sr03_039.pdf)

### Inferences
- The strongest ready-made sources are the NCHS Series 3 anthropometric reports (BMI, waist, weight) and NHSR 41 (resting pulse). They are nationally representative, have published percentiles, and are public domain.
- FRIEND is the only credible adult VO2max percentile source I found. It is a lab registry, not a population sample, so it probably skews toward people referred for or seeking testing.
- I found no peer-reviewed, population-sampled, age×sex percentile table for nocturnal wearable RMSSD with a clear license. HRV is the weakest benchmark candidate.
- Sleep has wearable means by age and sex but no reusable percentile tables in the sources I checked. NHANES self-reported sleep (questionnaire) microdata could be used to compute percentiles, but that means openhealth would derive the table itself (survey-weighted) rather than citing a published one.
- Blood pressure and lab values have NHANES public microdata. The project could compute weighted percentiles from it (feasible, but it is derived work). I did not find a ready-made adult BP or lab percentile publication in this pass.

### Gaps
- NHSR 41: the exact percentiles reported, adult age bands, measurement protocol and exclusions. The PDF fetch returned binary data that I could not parse.
- Paluch et al. 2022 (steps dose-response meta-analysis): not verified in this pass. It is a mortality dose-response study, not a percentile source, as the brief states.
- AASM/SRS (2015, ≥7 h) and NSF recommendations: not re-verified here.
- HUNT (Norway) fitness and HRV reference data, and Cooper Institute/ACSM VO2max tables: not checked.
- NHANES lab percentiles: whether NCHS publishes ready-made percentile tables for specific analytes was not checked. Reference intervals versus population percentiles was not researched.
- Adult blood pressure percentile tables from NHANES: not found or checked.

## Q2. License and redistribution terms

### Takeaway
NHANES/NCHS materials are public domain and safe to embed as derived tables with attribution. PLoS One papers (Quer 2020, Dodds 2014) are under a Creative Commons Attribution license. FRIEND (Mayo Clin Proc), Tudor-Locke (MSSE), JOSPT and Nunan (Wiley) tables are journal-copyrighted; reproducing the numeric tables in an OSS repo needs a license check or permission. Raw vendor data (Fitbit and others) is not available for redistribution.

### Cited Findings
- "Generally, data and materials produced by Federal agencies are in the public domain and may be reproduced without permission". NHANES report material "is in the public domain and may be reproduced or copied without permission; citation as to source, however, is appreciated." — [NCHS Vital Health Stat series 2 no. 184](https://cdc.gov/nchs/data/series/sr_02/sr02-184-508.pdf); [NHANES citation page](https://wwwn.cdc.gov/nchs/nhanes/NhanesCitation.aspx)
- NCHS public-use data may be used only for statistical analysis or reporting. The data user agreement also prohibits attempts to re-identify individuals. — [NCHS Data User Agreement](https://cdc.gov/nchs/policy/data-user-agreement.html)
- Quer 2020 (PLoS One) is under the Creative Commons Attribution License. — [PLoS One](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0227709)
- Fitbit cohort data in Quer 2020 and Natarajan 2020 are de-identified proprietary user data. Only the published summaries are accessible. — [PLoS One](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0227709); [Lancet DH](https://www.thelancet.com/journals/landig/article/PIIS2589-7500(20)30246-6/fulltext)

### Inferences
- Factual numbers such as a percentile value are often argued to be uncopyrightable in the US, while a table's selection and arrangement may be protected. Licensing outside the US differs. That is legal interpretation, not verified here. The safest path is NHANES/NCHS public-domain tables, or tables the project derives from NHANES microdata with documented code.
- For FRIEND, citing the source and linking out, or asking the registry (Ball State/FRIEND) for permission, is safer than copying the tables wholesale.

### Gaps
- Licenses for the Natarajan 2020 article (Lancet DH), Mayo Clin Proc FRIEND 2022, MSSE Tudor-Locke 2009, J Gerontol 2013 and JOSPT 2018 were not confirmed (page access was blocked or not checked).
- Whether FRIEND has a data-sharing or redistribution policy was not checked.

## Q3. Comparability: method, measurement context, population, era; which errors make a percentile meaningless

### Takeaway
Comparability is clear for some manual entries and weak or broken for others:
- **Comparable:** manually measured waist, weight, BMI and grip strength (with a dynamometer, same protocol).
- **Directionally comparable:** wearable RHR against wearable-cohort means.
- **Mismatched:** wearable "resting HR" against the NHANES seated clinical pulse, a different context.
- **Not comparable at the individual level:** wearable nocturnal RMSSD against 5-min supine ECG norms, wearable VO2max against lab-measured FRIEND percentiles, and wrist-worn step counts against hip-ActiGraph NHANES 2005–06 counts.

### Cited Findings
- **Wearable VO2max error, meta-analysis.** Molina-Garcia et al. 2022 (Sports Med, DOI 10.1007/s40279-021-01639-y; INTERLIVE network; 14 validation studies). Wearables that use resting-state algorithms overestimated VO2max, with bias 2.17 ml/kg/min and 95% limits of agreement of −13.07 to +17.41 ml/kg/min. Exercise-based algorithms showed lower error. The authors concluded that "the estimation error at the individual level is large". — [Sports Medicine](https://link.springer.com/article/10.1007/s40279-021-01639-y); [PMC9213394](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC9213394/)
- **Apple Watch validation.** Apple Watch Series 10 against indirect calorimetry: MAE 6.79 ml/kg/min (95% CI 4.91–8.67) and MAPE 13.2% (9.6–16.8). — [PMC13141568](https://pmc.ncbi.nlm.nih.gov/articles/PMC13141568/). A PLoS One Apple Watch validation found MAPE 13.31% and MAE 6.92 ml/kg/min, about 2–3 SD beyond the typical error of lab measurement (standard error about 2.58 ml/kg/min). — [PLoS One 2025](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0323741)
- **Garmin Forerunner 245.** Error depends on fitness level. It underestimated VO2max in highly trained athletes by 6.3 ml/kg/min (MAPE about 10%). — [PMC12881131](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC12881131/)
- **HRV method dependence.** Nunan 2010 found that short-term HRV values depend on methodology (RR editing) and were lower than Task Force norms. — [Wiley](https://onlinelibrary.wiley.com/doi/10.1111/j.1540-8159.2010.02841.x). Natarajan 2020 reports that HRV varies with time of day and activity level. — [MobiHealthNews](https://www.mobihealthnews.com/news/fitbit-study-finds-heart-rate-variability-fluctuates-age-gender-time-day-and-activity-level)
- **Wearable RHR definition.** Fitbit daily RHR is a proprietary algorithm that targets the supine on-waking value. The authors list device accuracy, algorithm differences and the demographic bias of wearable users as limitations. — [PLoS One](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0227709)
- **Steps method dependence.** NHANES 2005–06 used hip-worn ActiGraph. Censoring low-intensity steps changes the mean by about 3,100 steps/day (9,676 vs 6,540). — [Tudor-Locke 2009](https://www.researchgate.net/publication/26282350_Accelerometer-Determined_Steps_per_Day_inUS_Adults). Wrist-based NHANES 2011–14 step estimates vary by algorithm. — [arXiv 2410.11040](https://arxiv.org/html/2410.11040v1)
- **Grip method dependence.** Grip values differ between the NHANES and NIH Toolbox protocols. — [ResearchGate comparison](https://www.researchgate.net/publication/331539286_Handgrip_Strength_A_Comparison_of_Values_Obtained_From_the_NHANES_and_NIH_Toolbox_Studies). Dodds and NHANES use different populations (UK vs US) and different protocols.

### Inferences
- **VO2max.** Limits of agreement of about ±15 ml/kg/min, or MAE of about 7 ml/kg/min, roughly match the gap between FRIEND percentile bands within an age decade. A wearable VO2max placed on FRIEND percentiles could shift by one or more quintile bands. A coarse band ("below / near / above median") with an explicit uncertainty note is the most that can be defended. This is a judgment from the cited error sizes, not a published threshold.
- **HRV.** Nocturnal PPG RMSSD (overnight, sleep-dominated) should not be compared with 5-min supine ECG norms. If any comparison is shown, it should be against same-vendor cohort data, and since those are not published as percentile tables, honest options are limited to "your own baseline" trends.
- **RHR.** NHANES pulse is a clinic measurement (probably seated, radial; see the Q1 gap). Wearable sleeping or on-waking RHR typically runs lower, so comparing it with NHSR 41 would bias users toward "better than average". This direction is my inference and was not quantified in the sources.
- **Population and era.** NHANES is US and multi-ethnic, measured 1999–2018/2023. FRIEND is US lab-based, mostly a convenience sample. Dodds is British cohorts. Fitbit cohorts are wearable owners, who probably skew wealthier, more active and more often from high-income countries (my inference from the self-selected user base). A non-US user should be told which population the comparison uses.
- **Manual entries.** Waist, weight, height and BMI compare well with NCHS Series 3 if users measure the way NHANES does. The app should show the measurement instructions.

### Gaps
- No quantified offset between wearable nocturnal RHR and the NHANES seated pulse was found.
- Wrist-device step counts compared with hip ActiGraph in NHANES 2005–06 was not quantified in this pass.
- Consumer wearable sleep-duration bias compared with polysomnography was not checked here (one evaluation exists: [Sleep Advances 2026](https://academic.oup.com/sleepadvances/article/7/1/zpag006/8422777), not read).

## Q4. Existing open-source projects that publish such tables

### Takeaway
I found no open-source project that publishes a curated, licensed set of adult age×sex wellness percentile tables across these metrics. Existing projects are NHANES data-access libraries or single-purpose centile repositories. This looks like an open niche, with the caveat that the search was limited.

### Cited Findings
- `nhanesdata` (R): curated NHANES downloads via {nhanesA}, merged cycles 1999–2023, hosted as parquet files. — [GitHub kyleGrealis/nhanesdata](https://github.com/kyleGrealis/nhanesdata)
- `poldrack/nhanes`: a Python interface to NHANES. — [GitHub](https://github.com/poldrack/nhanes)
- `nhanes-youth-mims-percentiles`: age×sex percentiles of NHANES 2011–2014 wrist-accelerometer MIMS, for **youth aged 6–17 only**. It shows the "derive percentiles from NHANES microdata with code" pattern. — [GitHub](https://github.com/skwon10/nhanes-youth-mims-percentiles)
- `intraop-vital-centiles`: adult vital-sign centile tables and code, but for intraoperative anaesthesia, so not a wellness context. — [GitHub](https://github.com/Rogerking928/intraop-vital-centiles)
- RefCurv: open-source software for building reference (centile) curves (LMS-type). — [arXiv 1901.09775](https://arxiv.org/pdf/1901.09775)
- `nhanes-sas`: reproduces a CDC hypertension data brief with survey weights, an example of reproducible weighted NHANES estimates. — [GitHub](https://github.com/mrrishit909/nhanes-sas)

### Inferences
- A viable approach for openhealth: ship a versioned `reference_distributions` dataset derived from NHANES public microdata, with reproducible, survey-weighted code (nhanesA/nhanesdata plus the `survey` package). Each table would record its source cycle, method, population and license. For VO2max and HRV, cite external sources rather than embed them.

### Gaps
- GitHub and package registries were not searched exhaustively (for example, for Python packages that bundle FRIEND or ACSM tables, or open fitness apps with percentile features).
