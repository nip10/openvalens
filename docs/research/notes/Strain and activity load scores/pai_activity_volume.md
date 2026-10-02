# PAI and Weekly Activity-Volume Metrics: Evidence Review (as of Oct 2026)

Scope: Personal Activity Intelligence (PAI) evidence, comparison with guideline MVPA-minute / MET-minute / step metrics, and what a self-hostable general-wellness app (openhealth, adults 18+, no diagnosis) can honestly claim. TRIMP/session-RPE/WHOOP Strain and ACWR/injury are out of scope.

Method note: Abstracts and DOIs were checked against Europe PMC (PubMed mirror). Full texts of most Elsevier PAI papers (Am J Med, Prog Cardiovasc Dis, Mayo Clin Proc) were paywalled or returned 403, so numbers below come from the published abstracts unless stated otherwise. Evidence type is tagged on each item: [COHORT], [RCT], [META], [GUIDELINE], [PATENT], [VENDOR/INSTITUTIONAL PR].

---

## 1. Primary PAI papers: design, cohort, follow-up, outcomes, hazard ratios for PAI ≥100

### Takeaway
Every outcome paper on PAI is an observational cohort, and the original HUNT developer group (Wisløff/Nauman/Nes) wrote all of them. In each one, PAI was **back-calculated from self-reported leisure-time activity questionnaires**, not measured with heart-rate devices. Compared with "0 PAI" (inactive), PAI ≥100 is consistently linked with lower mortality. The effects are modest to moderate (HR about 0.72–0.93 for all-cause mortality and 0.48–0.87 for CVD mortality) and look a lot like standard "active vs inactive" contrasts. I found no independent replication in UK Biobank.

### Cited Findings
- **Nes et al. 2017, Am J Med 130(3):328-336, DOI 10.1016/j.amjmed.2016.09.031 (PMID 27984009)** [COHORT, derivation + validation]. The algorithm was derived in the HUNT Fitness Study (n = 4,631) and validated in the general HUNT population (n = 39,298, aged 20–74). Exposure groups: 0 (referent), ≤50, 51–99, ≥100 PAI. Mean follow-up was 26.2 years, with 10,062 deaths, 3,867 of them from CVD. Abstract: "Men and women with a PAI level ≥100 had 17% (95% CI 7%-27%) and 23% (95% CI 4%-38%) reduced risk of cardiovascular disease mortality, respectively, compared with the inactive groups." Also: "Participants who did not obtain ≥100 PAI had increased risk of dying regardless of meeting the physical activity recommendations." The conclusion calls PAI "an easily understandable and scientifically proven metric", which is strong causal-sounding language for an observational study — [Europe PMC/PubMed abstract](https://pubmed.ncbi.nlm.nih.gov/27984009/)
- **Kieffer et al. 2018, Mayo Clin Proc, DOI 10.1016/j.mayocp.2018.03.029 (PMID 30193673)** [COHORT, patients with CVD]. 3,133 HUNT1 (1984–86) participants with self-reported CVD, mean age 67.6, 64% men. Mean follow-up 12.5 years, with 2,936 deaths (94%). PAI ≥100 vs inactive: 36% (95% CI 21–48%) lower CVD mortality and 24% (95% CI 10–35%) lower all-cause mortality, "regardless of following contemporary PA recommendations or not" — [PubMed](https://pubmed.ncbi.nlm.nih.gov/30193673/)
- **Kieffer et al. 2019, Prog Cardiovasc Dis, DOI 10.1016/j.pcad.2018.09.002 (PMID 30227185)** [COHORT, repeated exposure]. 11,870 men and 13,010 women without CVD. PAI was estimated at HUNT1 (1984–86) and HUNT2 (1995–97), with mean follow-up of 18 years and 4,782 deaths. Results:
  - ≥100 at both time points vs <100 at both: CVD mortality AHR 0.68 (0.54–0.86); all-cause AHR 0.80 (0.71–0.91).
  - Rising from <100 to ≥100: CVD AHR 0.87 (0.74–1.03, not significant); all-cause AHR 0.86 (0.79–0.95).
  - "Increasing PAI score from <100 PAI in HUNT1 to ≥100 PAI in HUNT2 was associated with 6.6 years gained lifespan."
  
  — [PubMed](https://pubmed.ncbi.nlm.nih.gov/30227185/)
- **Nauman et al. 2021 (online 2020), Prog Cardiovasc Dis, DOI 10.1016/j.pcad.2020.05.005 (PMID 32560967)** [COHORT, first non-Norwegian cohort; ACLS, Cooper Clinic, Dallas]. 56,175 "relatively healthy" participants (26.5% women), enrolled 1974–2002. Median follow-up 14.9 years, with 3,434 deaths (1,258 CVD). PAI ≥100 vs 0:
  - Men: all-cause AHR 0.79 (0.71–0.87); CVD AHR 0.72 (0.60–0.87).
  - Women: all-cause AHR **0.85 (0.64–1.12), not significant**; CVD AHR 0.48 (0.26–0.91).
  - IHD, both sexes: AHR 0.70 (0.55–0.88).
  - "Participants with ≥100 weekly PAI gained 4.2 (95% CI, 3.5-4.6) years of life when compared with those who were inactive at baseline."
  - The authors themselves note that earlier PAI work was "conducted in the same populations from Norway where the PAI metric has been derived, limiting generalizability."
  
  Steven Blair (ACLS) and Ross Arena are co-authors. — [PubMed](https://pubmed.ncbi.nlm.nih.gov/32560967/)
- **Nauman et al. 2021, Prog Cardiovasc Dis, DOI 10.1016/j.pcad.2020.12.001 (PMID 33370551)** [COHORT, ACLS repeated exposure]. 17,613 participants with at least 2 exams. Median follow-up 9.3 years, with 1,144 deaths (400 CVD).
  - Maintained ≥100 at both exams vs 0 at both: CVD AHR 0.49 (0.26–0.95); all-cause AHR 0.58 (0.41–0.83); 4.8 (3.3–6.4) life-years gained.
  - Rising from 0 to ≥100: CVD AHR 0.75 (0.55–1.02, not significant); all-cause AHR 0.82 (0.69–0.99); 1.8 (0.1–3.5) years.
  
  — [PubMed](https://pubmed.ncbi.nlm.nih.gov/33370551/)
- **Nauman et al. 2022, Mayo Clin Proc, DOI 10.1016/j.mayocp.2021.10.022 (PMID 34865822)** [COHORT, China Kadoorie Biobank]. 443,792 healthy adults recruited 2004–2008. Median follow-up 8.2 years, with 21,901 deaths (9,466 CVD). PAI ≥100 vs 0:
  - CVD AHR 0.87 (0.81–0.94) in men and 0.84 (0.78–0.92) in women.
  - All-cause AHR 0.93 (0.89–0.97) in men and 0.93 (0.88–0.98) in women.
  - 2.7 (2.4–3.0) life-years gained.
  
  This is the largest cohort, and it has the smallest effects. — [PubMed](https://pubmed.ncbi.nlm.nih.gov/34865822/)
- **Hammer et al. 2022, J Clin Med 11(21):6552, DOI 10.3390/jcm11216552 (PMC9655296)** [COHORT, CKB, ischemic heart disease]. IHD aHR for PAI ≥100 vs 0 was 0.91 (0.83–1.00) overall and 0.84 (0.75–0.93) at age ≥60. Methods: "Weekly minutes of PA were calculated by multiplying the average frequency and duration, and the strenuousness of physical exertion was translated into a relative PA intensity using ~44%, 73%, and 83% of heart rate reserve for low-, moderate-, and vigorous-intensity activities." The authors list these limitations: observational design, self-reported PA, unmeasured confounders such as medications and diet — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9655296/)
- **Tari et al. 2022, eClinicalMedicine, DOI 10.1016/j.eclinm.2022.101607 (PMC9403490)** [COHORT, HUNT, dementia]. 29,826 participants with a median follow-up of about 24.5 years.
  - ≥100 at both assessments vs 0 at both: incident dementia aHR 0.75 (0.58–0.97); dementia mortality aHR 0.62 (0.43–0.91).
  - Rising from <100 to ≥100: aHR 0.83 and "2.8 … dementia-free years".
  
  — [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9403490/)
- **Nauman et al. 2025, Med Sci Sports Exerc, DOI 10.1249/mss.0000000000003584 (PMID 39499588)** [COHORT, HUNT, CHD]. 40,961 adults with a median follow-up of 13.1 years and 3,303 CHD events.
  - aHR 0.80 (0.71–0.91) for PAI 51–99 and 0.86 (0.78–0.95) for PAI ≥100. The ≥100 group did slightly *worse* than 51–99.
  - The authors conclude "A PAI score >50 was substantially associated with a reduced risk of CHD." They also report net reclassification improvement of 0.472.
  
  — [PubMed](https://pubmed.ncbi.nlm.nih.gov/39499588/)
- Other HUNT papers on surrogate outcomes, all [COHORT]:
  - Zisko 2017, PCAD, DOI 10.1016/j.pcad.2017.02.007: sedentary time and risk-factor clustering.
  - Kieffer 2021, Lancet Reg Health Eur, DOI 10.1016/j.lanepe.2021.100091: body weight.
  - Nauman 2019 review, PCAD, DOI 10.1016/j.pcad.2019.02.006. This review reports that PAI ≥100 was associated with higher VO2peak (+4.1 mL/kg/min in men, +2.9 in women).
  
  — [Europe PMC search results](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22personal%20activity%20intelligence%22); [Nauman 2019 PubMed](https://pubmed.ncbi.nlm.nih.gov/30797801/)
- **Conflicts of interest** (from the Hammer 2022 paper): "Ulrik Wisløff is the inventor of PAI and serves as a scientific consultant for PAI Health Inc, a software company that develops applications using data from heart rate monitors to display PAI." Wisløff is senior author on nearly all PAI outcome papers. Funding came from the Norwegian Research Council and the NTNU/Central Norway Regional Health Authority Liaison Committee — [PMC9655296](https://pmc.ncbi.nlm.nih.gov/articles/PMC9655296/)
- A search snippet attributes an earlier statement to a PAI paper: Wisløff "has, together with Norwegian University of Science and Technology, shares in Mio Global." I could not open the full text to confirm which paper says this — [search snippet; ScienceDirect PCAD ACLS paper](https://www.sciencedirect.com/science/article/pii/S0033062020301134)

### Inferences
- **The HR-based exposure has never been tested against outcomes.** The outcome evidence for "PAI" is really evidence for a questionnaire-derived intensity-weighted activity volume: self-reported frequency × duration × intensity mapped to a fixed %HRR (44/73/83%). None of the mortality cohorts used wearable HR. So the mortality association of "≥100 PAI computed from a wrist HR stream" is an extrapolation.
- Within each cohort, PAI ≥100 vs 0 is roughly the same contrast as "meets guidelines / vigorous-active vs inactive". The HRs (about 0.7–0.93) sit in the same range as standard physical-activity dose-response estimates (see Section 5). Nothing here shows PAI is a better predictor than MVPA minutes.
- Effect sizes shrink in larger and more diverse cohorts. CKB all-cause HR is 0.93, versus ACLS men 0.79. The ACLS all-cause result for women is not significant.
- The 2025 CHD paper's own finding that >50 PAI captures most of the benefit undercuts presenting 100 as a sharp threshold.
- The developer and his institution have commercial interests, and there is no independent group replication. Both are material limitations.

### Gaps
- **UK Biobank:** I found no PAI analysis of UK Biobank in Europe PMC (title search "personal activity intelligence", 2016–2026).
- **No independent replication:** I found no PAI outcome paper without Wisløff/Nauman/Nes as authors.
- **Covariates and sensitivity analyses:** I could not read the full adjustment sets (beyond what abstracts say) or reverse-causation sensitivity analyses for Nes 2017 and Nauman 2021 because they are paywalled. Kieffer 2019 mentions excluding the first 3 years.
- **Exact COI wording** in Nes 2017 (Am J Med) was not verified (403 on full text).

---

## 2. Is "100 PAI/week" and "~8 extra years" supported in the primary literature?

### Takeaway
The 100 threshold comes from the derivation: it is calibrated so that 100 PAI corresponds to a "healthy" VO2peak level (per the patent, about 45 mL/kg/min for men and 35 for women). It is not an outcome-optimised cut-point. The "~8 years" figure appears in NTNU/press material. I could not find it in any primary abstract. Primary abstracts report 2.7–6.6 life-years for specific contrasts, all observational and population-averaged.

### Cited Findings
- Life-year figures quoted in primary abstracts, all [COHORT]:
  - ACLS: 4.2 years (≥100 vs 0 at baseline) — [PMID 32560967](https://pubmed.ncbi.nlm.nih.gov/32560967/)
  - ACLS temporal: 4.8 years (maintained ≥100) and 1.8 years (0 → ≥100) — [PMID 33370551](https://pubmed.ncbi.nlm.nih.gov/33370551/)
  - CKB: 2.7 years — [PMID 34865822](https://pubmed.ncbi.nlm.nih.gov/34865822/)
  - HUNT temporal: 6.6 years (<100 → ≥100) — [PMID 30227185](https://pubmed.ncbi.nlm.nih.gov/30227185/)
  - HUNT dementia: 2.8 dementia-free years — [PMC9403490](https://pmc.ncbi.nlm.nih.gov/articles/PMC9403490/)
- NTNU CERG page [INSTITUTIONAL/PR, NTNU part-owns the Mia Health app]: people achieving 100 weekly PAI "live on average eight years longer than others" — [NTNU CERG](https://www.ntnu.edu/cerg/personal-activity-intelligence)
- Norwegian SciTech News (NTNU/SINTEF outlet) [PR]:
  - "those who earned 100 PAI or more lived an average of five years longer than those who earned less than 100 PAI" (HUNT 1980s, about 30-year follow-up).
  - "The ones who earned 100 PAI in both the 1980s and 1990s lived an average of eight years longer than those with lower PAI scores" (about 25,000 HUNT participants).
  
  — [Norwegian SciTech News, Feb 2020](https://norwegianscitechnews.com/2020/02/pai-a-training-tool-to-keep-you-young/)
- A secondary blog says people who fail to maintain 100 PAI lose 4.7 years of life on average (3.9 years in women, 6.0 in men). I did not verify this in the Nes 2017 full text, and it is not in the abstract — [Substack secondary source](https://ramkrishnan.substack.com/p/meet-pai-the-heart-rate-metric-that)
- Threshold derivation per the patent [PATENT]:
  - V = c3 + c4 × (1 − e^(−P)) maps the activity score P to predicted VO2peak.
  - PAI = 100 × (V − c3) / (V_threshold − c3).
  - The thresholds are ">45 for men, >35 for women".
  
  So 100 PAI is defined as the activity dose associated with reaching a target fitness level in the HUNT Fitness Study. — [Google Patents EP2921105A1](https://patents.google.com/patent/EP2921105A1/en)
- Nauman 2019 review: "individuals with a PAI score between 100 and 150 had expected age and sex specific average VO2peak values" — [PMID 30797801](https://pubmed.ncbi.nlm.nih.gov/30797801/)

### Inferences
- The "8 years" figure probably comes from the HUNT temporal analysis (Kieffer 2019: sustained ≥100 at both surveys). Its abstract reports HRs for that group but gives a life-year figure (6.6) only for the increaser group. I could not confirm a sustained-group life-year figure from the full text. Treat "~8 years" as press/marketing extrapolation of an observational, confounded, population-average contrast. It is not an individual prediction.
- Even the verified "years of life gained" figures are model-based contrasts between self-selected groups. They should not be presented as "doing X will add Y years".
- The 100 threshold is a reasonable convention, but it is a calibrated design choice. The 2025 CHD data suggest benefit already at >50.

### Gaps
- I could not access the Kieffer 2019 or Nes 2017 full text to confirm the exact source of "8 years" or "4.7 years".

---

## 3. Is the algorithm reproducible? IP and licensing status

### Takeaway
The patent family discloses the algorithm structure in enough detail for a re-implementation that is close in spirit:
- HRR normalisation
- exponential intensity weighting with fitted constants
- time integration
- a saturating mapping to predicted VO2peak
- scaling to 100 at a VO2peak threshold

Exact production constants (sex/age-specific), the rolling-window decay, and vendor details are not fully public. The patents are **active**: they have been reassigned from NTNU to a Chinese company (Beijing Shunyuan Kaihua Technology, linked to Huami/Zepp), with expiries of 2034 and 2041. An open-source app should not implement or name "PAI".

### Cited Findings
- **EP2921105** "Health risk indicator determination" [PATENT]:
  - Inventors: Ulrik Wisløff and Christian Ragnar Gutvik. Original assignee: NTNU. **Current assignee: Beijing Shunyuan Kaihua Technology Co Ltd.**
  - Priority date: 20 March 2014. Granted EP2921105B1 on 28 Feb 2018. Status: active, anticipated expiry 20 March 2034.
  - Family: US10973421B2 (active, expires 2034), **US11806120B2 (active, expires 2041)**, CN107077523B, JP6531161B2, AU2015233337B2, CA2943260C.
  
  — [Google Patents](https://patents.google.com/patent/EP2921105A1/en)
- Patent method, per the Google Patents description [PATENT]:
  - HR is sampled over ≥1 day, preferably 5+ days, at intervals of ≤15 min.
  - Normalised intensity ȳ = (y − y_rest)/(y_max − y_rest), i.e. HR reserve fraction.
  - Weighting z = c1·e^(c2·ȳ) − 1. Example constants for males: c1 = 4.51, c2 = 7.73.
  - Activity score P = Σ Δt·z.
  - V = c3 + c4(1 − e^(−P)), then PAI = 100 × (V − c3)/(V_threshold − c3).
  
  — [Google Patents](https://patents.google.com/patent/EP2921105A1/en)
- Algorithm inputs per NTNU: "age, your gender, your resting heart rate and your maximum heart rate" — [NTNU CERG](https://www.ntnu.edu/cerg/personal-activity-intelligence)
- PAI weights vigorous activity much more heavily than moderate. The 2025 MSSE abstract says PAI "credits vigorous over low- and moderate-intensity PA" — [PMID 39499588](https://pubmed.ncbi.nlm.nih.gov/39499588/)
- Commercial history per NTNU:
  - Mio (discontinued), Amazfit/Zepp watches, and the PAI Health app ("no longer updated").
  - Now the Mia Health app (partly owned by NTNU, launched 2023), which works with Fitbit, Apple Watch, Garmin, Polar, Suunto and Withings.
  
  — [NTNU CERG](https://www.ntnu.edu/cerg/personal-activity-intelligence)
- Hammer 2022 COI says PAI Health Inc develops PAI applications and Wisløff is its scientific consultant. A search snippet also reports that PAI Health Inc "holds the IP rights for PAI" — [PMC9655296](https://pmc.ncbi.nlm.nih.gov/articles/PMC9655296/)

### Inferences
- **IP risk:** Reproducing the PAI method (HRR → exponential weighting → integration → VO2-calibrated 0–100 scale) in a distributed open-source app risks infringing active US/EP patents until 2034/2041. "PAI" and "Personal Activity Intelligence" are also likely trademarks, though I did not verify trademark registration. Do not ship a feature called PAI or a clone of its formula without legal review.
- **Non-infringing alternatives:** WHO-style MVPA minutes or MET-minutes, and generic HR-zone minutes (e.g. "minutes ≥ X% HRR"), are long-standing public-domain constructs.
- **Two other caveats:**
  - Ownership: the current assignee and PAI Health Inc are separate entities. Who controls licensing today is unclear (see Gaps).
  - Fidelity: the patent example constants are not necessarily the production constants. An "approximate PAI" would not be validated against the cohort exposures anyway, because the cohorts used questionnaire-derived values.

### Gaps
- I did not verify the current status of PAI Health Inc, the licensing terms, or the "PAI" trademark registrations.
- I did not confirm the exact relationship between Beijing Shunyuan Kaihua and Huami/Zepp. That link is inferred from context, not a verified source.
- Full claim text was not reviewed. Claim scope (what exactly is protected) needs patent-attorney review.

---

## 4. Observational vs interventional evidence: has any RCT shown that targeting PAI improves outcomes?

### Takeaway
No. No RCT has tested PAI targeting against hard outcomes such as mortality or CVD events. Interventional evidence is limited to:
- one small pilot RCT in type 2 diabetes (n = 30, 12 weeks, PAI bundled with supervised exercise)
- feasibility studies
- one 18-month RCT in inactive adults (ONWARDS), where all three arms received a PAI tracker and accelerometer-measured MVPA *declined* over time

### Cited Findings
- **Coombes et al. 2022, MSSE, DOI 10.1249/mss.0000000000002768 (PMID 34334715)** [RCT, pilot].
  - Population: 30 adults with T2D not meeting PA guidelines.
  - Duration: 12 weeks.
  - Arms: PAI e-Health Program (wrist HR monitor + PAI app + "4 × 2 h·wk-1 sessions of exercise and counseling") vs PA attention control.
  - Results vs control: exercise capacity +63 s (17.9–108.0), sleep +67.2 min, body fat −1.3%.
  - Glycaemic control was measured, but the abstract reports no significant HbA1c effect.
  - Co-intervention confounds the PAI-specific effect.
  
  — [PubMed](https://pubmed.ncbi.nlm.nih.gov/34334715/)
- **Sagelv et al. 2025, BMJ Open Sport Exerc Med, DOI 10.1136/bmjsem-2023-001816 (PMID 40546750), ONWARDS** [RCT, hybrid effectiveness-implementation].
  - Population: 183 self-reported inactive adults aged 22–55, followed for 18 months.
  - Arms: (A) PAI tracker/app, (B) A + online training, (C) B + peer support. There was no no-tracker control.
  - Accelerometer MVPA fell from 69.7 to 60.2 min/day (p < 0.001), with no time × group interaction (p = 0.97). Waist circumference increased.
  - Participants were "self-reported inactive" but their baseline MVPA was "over two times higher than the criteria for inactive".
  - Co-author Nes is one of the PAI developers.
  
  — [PubMed](https://pubmed.ncbi.nlm.nih.gov/40546750/)
- A companion mixed-methods ONWARDS paper reports that PAI had satisfactory usability and positive effects on motivation and sustained use. This is qualitative/self-report evidence, not an outcome effect — [Front Public Health 2023, DOI 10.3389/fpubh.2023.1297844 via Europe PMC listing](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=%22personal%20activity%20intelligence%22)
- Feasibility-only studies [non-randomised/feasibility]:
  - Hannan 2021: cardiac rehab maintenance, DOI 10.1186/s13102-021-00350-9.
  - Bean 2023: clinic setting, DOI 10.1097/jcn.0000000000000950.
  - Coombes 2023: diabetic peripheral neuropathy, DOI 10.31128/ajgp-04-23-6797.
  
  — [Europe PMC](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22personal%20activity%20intelligence%22)
- Wen et al. 2021, Lancet Reg Health Eur (DOI 10.1016/j.lanepe.2021.100133) is a commentary, not a trial — [Europe PMC](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=TITLE:%22personal%20activity%20intelligence%22)

### Inferences
- What the evidence supports: a cohort association between a questionnaire-derived intensity-weighted activity volume and lower mortality, plus feasibility/acceptability of PAI apps.
- What it does not support: any claim that "using PAI" or "hitting 100 PAI" causes longer life. The best long-term RCT (ONWARDS) found no sustained increase in objectively measured MVPA among PAI-tracker users.

### Gaps
- I found no completed RCT with clinical endpoints. The ClinicalTrials.gov NCT03260114 ("PAI and Body Weight") appeared in search results, but I did not check its status or results.

---

## 5. Guideline alternatives (WHO 2020, dose-response meta-analyses) and computability

### Takeaway
WHO 2020 MVPA minutes (with vigorous counted double) and MET-minutes rest on far broader evidence (guideline-grade systematic reviews and pooled cohorts of hundreds of thousands of people). They can be computed from **manual logs with no device**. Step counts have strong meta-analytic dose-response data (Paluch 2022) and need only a phone or watch. PAI needs continuous HR and resting/max HR estimates, and its outcome evidence comes from one group's analyses of self-reported data.

### Cited Findings
- **WHO 2020 guidelines, Bull et al., Br J Sports Med 2020, DOI 10.1136/bjsports-2020-102955 (PMID 33239350)** [GUIDELINE]:
  - "All adults should undertake 150-300 min of moderate-intensity, or 75-150 min of vigorous-intensity physical activity, or some equivalent combination of moderate-intensity and vigorous-intensity aerobic physical activity, per week."
  - Muscle-strengthening is also recommended.
  - Key messages: "some physical activity is better than none, … more physical activity is better."
  - On sedentary time: "evidence was insufficient to quantify a sedentary behaviour threshold."
  
  — [PubMed](https://pubmed.ncbi.nlm.nih.gov/33239350/)
- **Arem et al. 2015, JAMA Intern Med, DOI 10.1001/jamainternmed.2015.0533 (PMID 25844730)** [POOLED COHORT].
  - Population: 661,137 adults across 6 NCI cohorts, with 116,686 deaths and median follow-up of 14.2 years. Activity was self-reported.
  - Compared with no leisure activity, mortality HRs were:
    - below the minimum of 7.5 MET-h/week: 0.80 (0.78–0.82)
    - 1–2× the minimum: 0.69 (0.67–0.70)
    - 2–3×: 0.63
    - plateau at 3–5×: 0.61 (0.59–0.62)
  - No harm at ≥10×: HR 0.69.
  - "Meeting the … minimum … was associated with nearly the maximum longevity benefit."
  
  — [PubMed](https://pubmed.ncbi.nlm.nih.gov/25844730/)
- **Ekelund et al. 2019, BMJ, DOI 10.1136/bmj.l4570 (PMID 31434697)** [META, harmonised IPD, accelerometry].
  - 8 studies, n = 36,383, mean age 62.6, median follow-up 5.8 years, 2,149 deaths.
  - Total PA quarters 2–4 vs lowest: HR 0.48, 0.34, 0.27.
  - Light PA: down to 0.38. MVPA: 0.64, 0.55, 0.52.
  - Sedentary time, highest quarter: HR 2.63.
  - "Any physical activity, regardless of intensity, was associated with lower risk of mortality, with a non-linear dose-response."
  
  — [PubMed](https://pubmed.ncbi.nlm.nih.gov/31434697/)
- **Paluch et al. 2022, Lancet Public Health, DOI 10.1016/S2468-2667(21)00302-9 (PMID 35247352)** [META, 15 cohorts].
  - n = 47,471, 3,013 deaths, median follow-up 7.1 years.
  - Quartile medians: 3,553 / 5,801 / 7,842 / 10,901 steps/day. HRs: 0.60, 0.55, 0.47 vs Q1.
  - Risk plateaued at "6000-8000 steps per day" for age ≥60 and "8000-10 000 steps per day" for age <60.
  - Stepping rate (cadence) was not significant after adjusting for steps (40+ and 100+ steps/min).
  - Funded by the US CDC.
  
  — [PubMed](https://pubmed.ncbi.nlm.nih.gov/35247352/)
- The PAI developers' own claim: participants below 100 PAI had elevated risk "regardless of meeting the physical activity recommendations" (Nes 2017; Kieffer 2018). This is presented as an advantage of PAI over guideline minutes. It is a within-cohort, single-group finding and has not been independently replicated — [PMID 27984009](https://pubmed.ncbi.nlm.nih.gov/27984009/); [PMID 30193673](https://pubmed.ncbi.nlm.nih.gov/30193673/)

### Inferences
**Computability by data source:**

| Metric | Manual log (type, duration, perceived intensity) | Phone/pedometer | Wrist HR | Outcome evidence base |
|---|---|---|---|---|
| WHO MVPA min/week (moderate + 2× vigorous) | Yes, directly | Partial (via cadence/"active minutes") | Yes (HR-zone minutes) | Guideline-grade, many cohorts and reviews |
| MET-minutes (Compendium METs × min) | Yes | Partial | Approximate | Strong (Arem pooled n = 661k) |
| Daily steps | No | Yes | Yes | Strong meta-analysis (Paluch) |
| Accelerometer total PA / MVPA | No | Device-dependent | Yes | IPD meta-analysis (Ekelund) |
| PAI-like HR-weighted score | Only via the cohort-style questionnaire approximation | No | Yes, but requires RHR/HRmax | Single developer group; HR-device version never outcome-tested; patented |

**Recommended default for openhealth:** weekly MVPA minutes with vigorous minutes counted double, shown against the WHO 150–300 band. This works from manual logs and from Health Connect exercise sessions or HR-zone minutes. Use steps/day as a secondary daily signal. Both are public-domain, guideline-anchored and explainable.

### Gaps
- I did not retrieve the 2018 US PAG Advisory Committee report or the ACSM position stand text in this pass. ACSM's intensity framework (%HRR / RPE) is referenced indirectly only.
- I did not retrieve the WHO 2020 "insufficient activity" definitions for MET-minutes (600 MET-min/week is the common surveillance threshold, but it is not cited here).

---

## 6. Applicability limits: beta-blockers, AF, wrist-HR accuracy, people without HR devices

### Takeaway
Any HR-reserve-weighted score depends on accurate resting HR, maximum HR and exercise HR. That makes it unreliable for:
- people on rate-controlling drugs (beta-blockers, some calcium-channel blockers)
- people with AF or other arrhythmias, or with pacemakers
- resistance training and cycling, where wrist PPG under-reads
- people with no HR device

Guideline minutes logged with perceived intensity (RPE / talk test) degrade more gracefully.

### Cited Findings
- **Wrist-PPG accuracy** (Journal of Sports Sciences 2020 systematic review and meta-analysis, DOI 10.1080/02640414.2020.1767348) [META]:
  - Mean difference vs criterion HR: −0.01 bpm at rest, −0.51 bpm on treadmill, **−7.26 bpm during resistance training** and **−4.55 bpm during cycling**.
  - Error grows by about 3 bpm per 10 bpm HR increase in resistance training.
  - Numbers come from search abstract snippets; I did not read the full text.
  
  — [Taylor & Francis](https://www.tandfonline.com/doi/full/10.1080/02640414.2020.1767348); [ResearchGate abstract](https://www.researchgate.net/publication/342315950_Validity_of_Wrist-Worn_photoplethysmography_devices_to_measure_heart_rate_A_systematic_review_and_meta-analysis)
- Another meta-analysis summarised in search results reports consumer wrist-device MAE of about 2.15 bpm at rest vs 7.70 bpm during locomotion. I could not confirm which paper this is, so treat it as unverified — [search results; see PMC9445511 for wrist devices and exercise intensity](https://pmc.ncbi.nlm.nih.gov/articles/PMC9445511/)
- PPG accuracy may vary with skin tone (melanin absorbs green light); this has been studied during exercise — [PLOS One 2025, DOI 10.1371/journal.pone.0318724](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0318724)
- **Cardiac patients:** a 2026 JMIR mHealth systematic review covers HR monitors for estimating physical activity in CVD patients (DOI 10.2196/79995). Not read in full — [Europe PMC listing](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=%22personal%20activity%20intelligence%22)
- **Beta-blockers:**
  - They blunt HR response. RPE is the standard alternative for regulating intensity.
  - A study of β-blockade found the RPE–HR relationship was altered while RPE–VO2 stayed stable.
  
  — [PMC12528277](https://pmc.ncbi.nlm.nih.gov/articles/PMC12528277/); [PubMed 8776008](https://pubmed.ncbi.nlm.nih.gov/8776008/); [ACSM handout](https://www.acsm.org/wp-content/uploads/2025/02/Exercising-Your-Way-to-Lowering-Your-Blood-Pressure-handout.pdf)
- **People without HR devices:** the PAI algorithm requires heart-rate data plus age, sex, RHR and max HR — [NTNU CERG](https://www.ntnu.edu/cerg/personal-activity-intelligence); [patent](https://patents.google.com/patent/EP2921105A1/en)

### Inferences
- An HRR-based weekly score will **undercount** activity for beta-blocker users (lower HR at the same workload). PAI weights intensity exponentially, so small HR errors at high intensity are amplified. An AF user's irregular, often elevated HR could **overcount**. A general-wellness app should detect or allow self-declaration of these conditions and fall back to duration + RPE logging. It must not make any clinical statement.
- Age-predicted HRmax (e.g. 220 − age) has a large individual error (commonly cited SD of about 10–12 bpm; not verified in this pass). Any HRR metric should let users override HRmax and RHR.
- Resistance training is credited poorly by both wrist PPG and HR-based scores. WHO's separate muscle-strengthening recommendation should be tracked independently.

### Gaps
- I found no PAI-specific validation in AF, pacemaker or beta-blocker populations. The Kieffer 2018 CVD cohort used questionnaire PAI and did not report medication stratification in its abstract.
- I did not verify the HRmax prediction-error figures.

---

## Synthesis for openhealth: what claims are defensible (input for report writer)

### Takeaway
A self-hosted wellness app can honestly say that higher weekly moderate-to-vigorous activity is associated with lower mortality in large observational studies, and that WHO recommends 150–300 min/week of moderate activity (or 75–150 vigorous). It should not claim a weekly score adds years of life, prevents disease, or is "scientifically proven". It should not implement or brand "PAI" (active patents, likely trademark).

### Cited Findings
- WHO wording supports "some physical activity is better than none" and "more physical activity is better" — [Bull 2020](https://pubmed.ncbi.nlm.nih.gov/33239350/)
- Meeting the guideline minimum captures "nearly the maximum longevity benefit" observationally — [Arem 2015](https://pubmed.ncbi.nlm.nih.gov/25844730/)
- PAI outcome evidence is observational, single-group, questionnaire-derived and developer-conflicted. The only long-term RCT showed no MVPA gain — [PMID 32560967](https://pubmed.ncbi.nlm.nih.gov/32560967/); [PMC9655296 COI](https://pmc.ncbi.nlm.nih.gov/articles/PMC9655296/); [ONWARDS](https://pubmed.ncbi.nlm.nih.gov/40546750/)

### Inferences
- **Suggested honest copy:** "This week: 165 activity-minutes (vigorous minutes count double). The WHO recommends 150–300 for adults. In large population studies, people who meet this range tend to have lower rates of heart disease and early death; these studies show association, not proof that the activity alone caused it."
- **Avoid:** "+8 years of life", "reduces your risk by X%", "scientifically proven", or any personalised risk number. A personalised risk number moves toward diagnosis/risk prediction and potential medical-device classification. That regulatory assessment is out of scope but worth flagging.
- **Confidence/readiness signal:** match it to the data source (manual log vs HR-zone vs steps), in line with the repo's "explicit confidence/readiness" rule.

### Gaps
- Regulatory classification (EU MDR / FDA general-wellness guidance) of a weekly activity score was not researched here.
