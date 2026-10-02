# Internal training-load / daily strain models: formulas, validation, and fitness for a general-adult wellness app

Scope: session- and day-level load quantification (Banister TRIMP, Edwards SHRZ, Lucia TRIMP, Foster session-RPE, WHOOP Strain, Firstbeat EPOC/Garmin, Polar Training Load Pro). Excludes PAI/mortality and ACWR/injury prediction (other researchers). Notes current as of October 2026. Evidence type and population are tagged in brackets for each claim. Where I could not open a primary source directly, I say so.

## 1. Original formulas, inputs and assumptions (Banister 1991, Edwards 1993, Lucia 2003, Foster 1998/2001)

### Takeaway
All three HR-based models are simple, published, and easy to reimplement. Each needs a duration plus HR data and personal anchors. Banister uses HRrest, HRmax, and sex-specific exponential weights fitted to lactate curves. Edwards uses only HRmax-based zones. Lucia needs lab-measured ventilatory thresholds. Session-RPE needs only a 0–10 rating × minutes. That makes it the only one of these that works without a device, and Lucia is impractical for consumers.

### Cited Findings
- **Banister TRIMP**: duration (min) × HRR fraction × weighting, where HRR fraction = (HRavg − HRrest)/(HRmax − HRrest). Weighting is 0.64·e^(1.92·HRR) for males and 0.86·e^(1.67·HRR) for females [secondary summary of the formula] — [trainingimpulse.com / iamcoach summary](https://www.iamcoach.ai/blog/trimp-training-load-explained); the coefficients match those widely reproduced in the literature. The original is cited as Banister (1991) in peer-reviewed comparisons — [Paulson et al. 2015, Front Physiol](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2015.00388/full).
- Polar's vendor description of the same formula: the weighting "is based on the relationship between heart rate and blood lactate observed during incremental exercise." Inputs are HR(t), HRrest and HRmax from user settings, with separate equations for males and females. Polar computes it every second and sums the result [vendor white paper, Nov 2019, updated Mar 2025] — [Polar Training Load Pro white paper](https://www.polar.com/img/static/whitepapers/pdf/polar-training-load-pro-white-paper.pdf).
- Assumptions and limitations Polar itself states for Banister TRIMP: (1) HR handles short, very high-intensity (anaerobic) bouts poorly, "such as strength training and certain team sports"; (2) the "generic weighting equations… only differentiate between males and females," so "gender is not the sole factor" and individual differences go unmodelled. Fitter people get a lower TRIMP for the same external work [vendor] — [Polar white paper](https://www.polar.com/img/static/whitepapers/pdf/polar-training-load-pro-white-paper.pdf).
- **Edwards summated HR zones (SHRZ)**: minutes in 5 zones (50–60, 60–70, 70–80, 80–90, 90–100 % HRmax) × multipliers 1–5, summed — [secondary summary](https://www.iamcoach.ai/blog/trimp-training-load-explained). Cited as Edwards (1993) in peer-reviewed work — [Paulson et al. 2015](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2015.00388/full). The zone bounds are confirmed in a primary paper: "zone 4 of SHRZ (ie, 80% to 90% HRmax)", "zone 1 … (50% to 60% HRmax)" — [Borresen & Lambert 2008, IJSPP 3:16–30, doi:10.1123/ijspp.3.1.16](https://doi.org/10.1123/ijspp.3.1.16).
- **Lucia TRIMP**: 3 zones bounded by the ventilatory threshold (VT) and respiratory compensation point (RCP), weighted 1/2/3, multiplied by minutes in each zone. It comes from Lucia, Hoyos, Santalla, Earnest & Chicharro, "Tour de France versus Vuelta a España: which is harder?", Med Sci Sports Exerc 2003;35:872–878. Its population was 7 professional cyclists with lab-derived thresholds [primary; elite male cyclists] — [Univ. Bath research portal record](https://researchportal.bath.ac.uk/en/publications/tour-de-france-versus-vuelta-a-espana-which-is-harder); [Paulson et al. 2015](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2015.00388/full). Applied studies often swap in lactate thresholds because VT/RCP testing is impractical — [Paulson et al. 2015](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2015.00388/full).
- **Foster session-RPE**: session load = CR-10 rating of the whole session (0 "Rest" … 10 "Maximal") × session duration (min) — [Haddad et al. 2017, Front Neurosci, PMC5673663](https://pmc.ncbi.nlm.nih.gov/articles/PMC5673663/). The founding validation paper is Foster C, Florhaug JA, Franklin J, et al., "A new approach to monitoring exercise training," J Strength Cond Res 2001;15:109–115 (doi:10.1519/1533-4287(2001)015<0109:anatme>2.0.co;2). Subjects did steady-state and interval cycling or basketball practice. sRPE was compared with an objective HR summated-zone method. The relationship was "highly consistent," though absolute sRPE scores were "significantly greater" than HR scores. The authors concluded sRPE is "a valid method of quantitating exercise training during a wide variety of types of exercise" [primary; small samples of trained/active subjects] — [Europe PMC record PMID 11708692](https://europepmc.org/article/MED/11708692).
- Foster 1998 (the overtraining/monotony paper) is the usual earlier origin citation. I did not open it in this session; see Gaps.

### Inferences
- An app can compute Banister and Edwards from Health Connect HR streams with only HRmax (age-predicted or user-entered) and HRrest (from wearable sleep data). Lucia needs lab thresholds and should be excluded for general users.
- Banister's sex coefficients came from lactate curves in a small group of (likely male, trained) subjects and give no option for non-binary or unspecified sex. An open-source app would need a documented default, such as the average of both curves or Edwards as the fallback.
- Both Edwards and Banister depend heavily on the HRmax estimate. Age-predicted HRmax error (often ±10+ bpm) shifts zone time and load directly. This is an inference; I did not source a quantitative estimate here.

### Gaps
- I did not retrieve the primary text of Banister 1991 (book chapter in *Physiological Testing of the High-Performance Athlete*) or Edwards 1993 (*The Heart Rate Monitor Book*). The coefficients come from secondary summaries and Polar's vendor paper.
- I did not open Foster 1998 (MSSE, overtraining) to confirm its formulas.

## 2. Validation evidence: sRPE vs HR-based TRIMP, reliability, populations (including non-athletes)

### Takeaway
sRPE correlates moderately to very strongly with HR-based TRIMPs: r ≈ 0.5–0.99 across 36 studies, mostly in athletes. Agreement weakens for high-intensity, intermittent, and resistance work, and for individuals who train mostly at low intensity. Evidence in ordinary non-athlete adults is thin: a few recreational samples, one 2008 mixed-training study, and some clinical exercise programmes. No study validates daily summed load as a wellness metric in general adults.

### Cited Findings
- Haddad et al. 2017, "Session-RPE Method for Training Load Monitoring: Validity, Ecological Usefulness, and Influencing Factors," Front Neurosci (PMID 29163016) [narrative review of 36 studies]. Correlations of sRPE with Banister TRIMP ranged r = 0.52–0.99, with Edwards r = 0.52–0.97, and with Lucia r = 0.59–0.94. Reliability ICCs ranged from fair (0.40–0.59) to excellent (0.75–1.00), with most between 0.69 and 0.95. Populations were athletes of both sexes, children to adults, across expertise levels and team and individual sports. The review flags weak agreement between coach-prescribed and athlete-perceived intensity — [PMC5673663](https://pmc.ncbi.nlm.nih.gov/articles/PMC5673663/); [PubMed 29163016](https://pubmed.ncbi.nlm.nih.gov/29163016/).
- Borresen & Lambert 2008, IJSPP [primary; n = 33 participants training ad libitum for 2 weeks; training status described in abstract only as "participants"]. TRIMP vs sRPE load gave r = .76 (95% CI .56–.88), and SHRZ vs sRPE gave r = .84 (.70–.92). Regression over-predicted for those spending more time at 80–90 % HRmax (zone 4) and under-predicted for those spending more time at 50–70 % HRmax. The authors conclude sRPE "provides reasonably accurate assessments … but they deviate in accuracy when proportionally more time is spent training" at low or high intensities — [doi:10.1123/ijspp.3.1.16](https://doi.org/10.1123/ijspp.3.1.16).
- Crawford et al. 2018, Sports (Basel) [primary; 25 recreationally active adults (13 M, 12 F), mean age ~21–23, new to high-intensity functional training, 6 weeks]. sRPE vs Edwards gave r = 0.889 and vs Banister TRIMP r = 0.561. Reliability was poor-to-moderate (ICC = 0.586, 52 % agreement on HR quartiles) and improved with familiarisation (ICC 0.560 → 0.613). RPE was taken ~5 min post session — [PMC6162783](https://pmc.ncbi.nlm.nih.gov/articles/PMC6162783/).
- Yang et al. 2024, Front Neurosci [elite cross-country skiers, n = 10]. Overall sRPE–TRIMP r = 0.68. By intensity: low r = 0.70, moderate r = 0.46, high r = 0.31. This shows the correlation is intensity-dependent — [PMC11155691](https://pmc.ncbi.nlm.nih.gov/articles/PMC11155691/).
- Paulson et al. 2015, Front Physiol [14 international wheelchair rugby players]. HR-based methods related very strongly to total distance (r > 0.80). sRPE was weaker (r = 0.59), and weaker still for high-intensity activity (r = 0.32–0.35), with large between-individual variation — [Front Physiol 2015](https://www.frontiersin.org/journals/physiology/articles/10.3389/fphys.2015.00388/full).
- Clinical and older-adult signals [low-certainty; search-snippet level, not opened in full]. sRPE was reported valid for monitoring exercise intensity in adults with acute burn injuries — [PMC11843880](https://pmc.ncbi.nlm.nih.gov/articles/PMC11843880/). A study in physically active older adults (~67 y) validated first-repetition RPE (OMNI elastic-band scale) against training volume and EMG; this is RPE, not session load — [PubMed 41488376](https://pubmed.ncbi.nlm.nih.gov/41488376/). A cardiac-rehab literature review reports Borg RPE as valid for intensity monitoring "independent of gender, age, exercise modality, physical activity level and CAD status" — [ScienceDirect review](https://www.sciencedirect.com/science/article/pii/S1877065716000385). I did not verify these beyond abstracts and snippets.

### Inferences
- The validation evidence comes overwhelmingly from athletes and young, recreationally active people. Transfer to sedentary, older, or medicated adults is plausible but unproven. Beta-blockers and other chronotropic drugs would break HR-based TRIMP specifically, which favours sRPE as the more robust primary metric. This is my inference; I did not source a beta-blocker/TRIMP study here.
- Correlation is not agreement. The TRIMP methods themselves are not a gold standard (Firstbeat notes TRIMP "does not have physiological basis or scale"), so "validity" here largely means convergent validity between two proxies.
- For new exercisers, the Crawford data suggest sRPE reliability improves after a few weeks. The app could show a "calibrating" state during the first ~2–4 weeks.

### Gaps
- I found no study validating daily total sRPE load (summed across sessions plus lifestyle activity) against any outcome in general, non-athlete adults.
- I did not open full texts of the burn-injury, older-adult, or cardiac-rehab sRPE studies; sample sizes and statistics are unverified.

## 3. WHOOP Strain, Firstbeat EPOC/Garmin training load, Polar Training Load Pro: disclosure and validation

### Takeaway
All three are proprietary. Firstbeat has the most disclosure: a white paper with one small lab validation of EPOC prediction, an r² of 0.79 against measured EPOC in 32 healthy adults, run by the company's own research group. Polar's "Cardio load" is openly Banister TRIMP, and its "Perceived load" is plain sRPE, but there is no product-level validation. WHOOP discloses only the 0–21 Borg-inspired, non-linear scale and its broad inputs. As of October 2026, the only peer-reviewed WHOOP-Strain-vs-sRPE study I found is a 2026 single-athlete case study. None is suitable to copy, but Polar's approach shows that standard published methods (Banister + sRPE) are what an open app can legitimately use.

### Cited Findings
- **WHOOP (vendor material)**: "The Strain score is a number on a 0 to 21 scale, based on the Borg Scale of Perceived Exertion" and "Strain is not on a linear scale. It takes more stress to move from a score of 16 to 17 than 4 to 5" — [WHOOP developer docs, WHOOP 101](https://developer.whoop.com/docs/whoop-101/). WHOOP marketing describes HR-zone time weighted by personal HRmax plus "muscular load" when strength activity is detected or logged — [WHOOP: How does Strain work](https://www.whoop.com/us/en/thelocker/how-does-whoop-strain-work-101/) (page returned 403 to my fetch; content seen only via search snippet). No formula is published.
- Doherty et al. 2025 characterise WHOOP Strain from public documentation. Contributors are "cardiovascular load" (HR) and "muscular load (movement physics, accelerometer, gyroscope)." It "Integrates 'cardiovascular and muscular loads' using a personalized, dynamic proprietary algorithm" on a "Logarithmic scale [that] adjusts based on individual fitness baselines." The score resets with the sleep cycle, and the bands are Light 0–9, Moderate 10–13, High 14–17, All out 18–21. Strain incorporated only 2 of the 12 tracked signal types (17 %) [independent review of documentation] — [Doherty et al. 2025, Transl Exerc Biomed 2(2), doi:10.1515/teb-2025-0001](https://www.degruyterbrill.com/document/doi/10.1515/teb-2025-0001/html).
- Peer-reviewed WHOOP Strain validation: one exploratory longitudinal single-case study of 1 elite junior swimmer (Jan–Jul 2026). It found WHOOP Activity Strain positively associated with sRPE load, sRPE, and swim distance [n = 1; funding not checked; full text returned 403] — [JFMK 2026;11(3):369, doi:10.3390/jfmk11030369](https://doi.org/10.3390/jfmk11030369). I found no independent validation in general adults.
- **Firstbeat EPOC (vendor white paper, "Indirect EPOC Prediction Method Based on Heart Rate Measurement," published May 2005, updated March 2012)**:
  - Model construction: built from "meta-analysis data of peer-reviewed articles" covering 48 exercise settings and 158 trained and untrained men and women. Durations ranged 2–180 min and intensities 18–108 % VO2max, covering running, cycling and upper-body ergometry.
  - Inputs: EPOC(t) = f(EPOC(t−1), intensity(t) as %VO2max, Δt). Intensity is estimated from HR, HRmax and HRV-derived respiration rate.
  - Validation: Rusko et al. 2003, 32 healthy adults, age 38 ± 9 y, VO2max 44 ± 8.8 ml/kg/min, cycle ergometer. Predicted vs measured EPOC gave r² = 0.79, with MAE of 9.4, 14.0 and 16.9 ml/kg (40 %, 70 % VO2max, maximal test) and 13.7 ml/kg pooled. HR-based EPOC vs blood lactate r² = 0.79.
  - Stated limitation: "EPOC reflects mainly aerobic properties … in strength exercise, EPOC may be low although the individual would be exhausted" [vendor; validation by company-affiliated researchers; Rusko 2003 appears to be a conference abstract] — [Firstbeat EPOC white paper](https://www.firstbeat.com/wp-content/uploads/2015/10/white_paper_epoc.pdf).
- Garmin Body Battery is "powered by Firstbeat Analytics™" — [Doherty et al. 2025](https://www.degruyterbrill.com/document/doi/10.1515/teb-2025-0001/html). I did not find a Garmin-specific peer-reviewed validation of Garmin's 7-day "acute training load" (EPOC sum) in this session.
- **Polar Training Load Pro (vendor white paper, Nov 2019 / Mar 2025)**:
  - Cardio load = Banister TRIMP, chosen "Based on a survey of scientists and practitioners."
  - Muscle load = mechanical energy (kJ) from power; running/cycling only.
  - Perceived load = "RPE * duration," with RPE entered post-session on a 1–10 scale, citing Foster 2001.
  - Strain = 7-day rolling average and Tolerance = 28-day average (Banister fitness-fatigue analogy).
  - The "Validity" section says only that calculations "are based on scientifically accepted methods," citing an IOC consensus. No product-specific validation data is given [vendor] — [Polar white paper](https://www.polar.com/img/static/whitepapers/pdf/polar-training-load-pro-white-paper.pdf).

### Inferences
- WHOOP's 0–21 scale cannot be reproduced. Reimplementing a lookalike would invite trademark or product confusion and claims of equivalence that can't be backed up. A transparent, published method (Banister/Edwards/sRPE) is defensible; a "strain"-branded log scale is not.
- Firstbeat's r² = 0.79 is a group-level fit in a lab cycling protocol. MAE of ~14 ml/kg is large relative to low-intensity EPOC values (my inference). It is not evidence of accuracy in free-living, mixed-modality general adults.

### Gaps
- No independent peer-reviewed validation of WHOOP Strain, Garmin acute load, or Polar Cardio load found for general adults.
- Funding and conflicts for the JFMK 2026 WHOOP case study are unverified (full text 403).
- The search-snippet claim that Firstbeat's individual EPOC error is "extremely large" could not be traced to a primary source and is excluded.

## 4. Doherty et al. 2025 (Transl Exerc Biomed, doi 10.1515/teb-2025-0001): what it actually reports about strain scores

### Takeaway
I read the full text. It is a documentation-based review of 14 composite health scores (CHS) from 10 manufacturers, not an empirical validation. On strain, it reports WHOOP Strain's inputs (HR plus accelerometer/gyroscope "muscular load"), its proprietary personalised logarithmic 0–21 scale, its bands, and its sleep-cycle reset. It found no disclosed formula and no peer-reviewed validation of the composite. It explicitly excluded dedicated training-load metrics, so Garmin/Firstbeat training load and Polar Training Load Pro were not assessed.

### Cited Findings
- Bibliographic: Doherty C, Baldwin M, Lambe R, Burke D, Altini M. Translational Exercise Biomedicine 2(2), published April 10, 2025, open access (CC BY). Funded by Health Research Board Ireland (HRB ILP-PHR-2024-005) and Research Ireland (12/RC/2289_P2). "The authors state no conflict of interest" — [De Gruyter Brill full text](https://www.degruyterbrill.com/document/doi/10.1515/teb-2025-0001/html); [Semantic Scholar metadata](https://www.semanticscholar.org/paper/Readiness,-recovery,-and-strain:-an-evaluation-of-Doherty-Baldwin/c98de374f78ebeb0c563e0842cee18a9c53a6efb).
- Method: secondary analysis drawing on a living umbrella review of wearable accuracy plus the top-10 manufacturers by market share, using public documentation (white papers, manuals, app screenshots, patents, research). Exclusion criteria included "metrics explicitly tied to training load or other sport-specific performance measures" — [full text](https://www.degruyterbrill.com/document/doi/10.1515/teb-2025-0001/html).
- Strain-specific content: "WHOOP's Strain metric focuses on cardiovascular exertion, ostensibly helping users optimize performance and avoid overtraining." Strain "integrates cardiovascular (from PPG-derived heart rate) and muscular (from accelerometery-derived activity) loads, which are adjusted based on individual fitness levels and baseline data." The authors also write: "WHOOP's Strain Score uses a logarithmic scale of 0–21, where higher strain values are progressively harder to achieve." WHOOP's algorithms "prioritize immediate physiological responses, reset scores with sleep cycles." Table 4 gives the bands Light 0–9, Moderate 10–13, High 14–17, All out 18–21. Strain requires a paid subscription — [full text](https://www.degruyterbrill.com/document/doi/10.1515/teb-2025-0001/html).
- General conclusions that apply to Strain: "none of the companies disclose specific details about the algorithms or formulae used – nor the relative weightings." The composite indices "have undergone little to no validation in the peer-reviewed scientific literature." Opaque algorithms present "significant barriers to independent scrutiny." The only empirical WHOOP data discussed concern Recovery, not Strain: in a 2023 elite swimmer study, Recovery showed no correlation with self-reported stress or recovery — [full text](https://www.degruyterbrill.com/document/doi/10.1515/teb-2025-0001/html).

### Inferences
- Doherty et al. support a design principle for this app: any load score should publish its formula, inputs and weightings, and be labelled as an estimate without outcome validation in general adults.
- Because training-load metrics were excluded by design, the paper says nothing about Garmin/Firstbeat or Polar load validity. It should not be cited as evaluating them.

### Gaps
- Marco Altini is a co-author. His commercial ties (e.g., HRV4Training) were not declared and I did not verify them; the paper's statement is "no conflict of interest."

## 5. Strength/resistance training: HR-model underestimation and alternatives

### Takeaway
HR-based loads (TRIMP, EPOC, and by extension HR-driven Strain) systematically under-represent resistance and short anaerobic work. Both vendors (Polar, Firstbeat) say so in their own documentation. sRPE is the best-supported internal-load alternative for lifting: it rises with %1RM even when total work falls, with ICC 0.88. Volume-load (sets × reps × kg) is the standard external-load complement.

### Cited Findings
- Polar: HR handles "short bouts of very high intensity (anaerobic energy supply), such as strength training" poorly [vendor] — [Polar white paper](https://www.polar.com/img/static/whitepapers/pdf/polar-training-load-pro-white-paper.pdf).
- Firstbeat: "in strength exercise, EPOC may be low although the individual would be exhausted" [vendor] — [Firstbeat EPOC white paper](https://www.firstbeat.com/wp-content/uploads/2015/10/white_paper_epoc.pdf).
- Day, McGuigan, Brice & Foster 2004, JSCR 18:353–358 [primary; 9 men and 10 women, ~22–25 y; 5 lifts at 90 %, 70 % and 50 % 1RM, each performed twice]. Session RPE was measured 30 min post-exercise and was higher for the high-intensity bout. "Performing fewer repetitions at a higher intensity was perceived to be more difficult." ICC = 0.88 — [doi:10.1519/r-13113.1](https://doi.org/10.1519/R-13113.1).
- Sweet, Foster, McGuigan & Brice 2004, JSCR 18:796–802 [primary; 10 men and 10 women habituated to aerobic and resistance training]. "The resistance training session RPE increased as the intensity increased despite a decrease in the total work performed." sRPE appears "viable … generally comparable to aerobic training," but per-lift RPE "varied widely" between exercises at the same %1RM — [doi:10.1519/14153.1](https://doi.org/10.1519/14153.1).
- Implication from the Sweet and Day results: volume-load (external work) and sRPE (internal load) diverge for lifting. Heavy low-rep sets have lower volume-load but higher sRPE, so neither alone captures the full picture. Polar cites Scott et al. 2016, "Training Monitoring for Resistance Exercise: Theory and Applications," Sports Med (doi:10.1007/s40279-015-0454-0), as the resistance-monitoring reference. I did not open it — [Polar white paper reference list](https://www.polar.com/img/static/whitepapers/pdf/polar-training-load-pro-white-paper.pdf).
- Haddad et al. 2017 report sRPE applicability to resistance training across multiple studies [review; athletes] — [PMC5673663](https://pmc.ncbi.nlm.nih.gov/articles/PMC5673663/). Crawford et al. 2018 found sRPE tracked Edwards closely (r = 0.889) but Banister TRIMP only moderately (r = 0.561) in mixed functional/HIIT sessions [recreational adults] — [PMC6162783](https://pmc.ncbi.nlm.nih.gov/articles/PMC6162783/).
- WHOOP added a "Strength Trainer"/muscular-load component that relies on accelerometry or logged lifts. I have only tech-press coverage of a Feb 2026 update, with no validation data [secondary/blog] — [the5krunner, Feb 2026](https://the5krunner.com/2026/02/28/new-whoop-strength-trainer-update/).

### Inferences
- For a mixed-modality wellness app, the most defensible design is:
  - Primary load is sRPE × duration for every session, whether from a device or entered manually.
  - HR-TRIMP (Edwards or Banister) is an optional secondary "cardio load" when HR exists.
  - Volume-load is shown as a descriptive strength metric, not merged into one score.
  - The three should not be fused into one opaque number.

### Gaps
- Volume-load validity data (vs sRPE or outcomes) in general adults was not retrieved in this session.
- No independent validation found for accelerometer-based "muscular load" (WHOOP) or similar vendor features.

## 6. sRPE × duration as a manual-friendly metric; CR-10 in general adults; recall timing

### Takeaway
sRPE × minutes (CR-10) is the only reviewed method that needs no device. It is cross-modal, published, and openly reusable. Its validity is moderate-to-strong against HR methods, but the evidence is mostly in athletes and young recreational adults. The 30-minute post-session rule is convention rather than necessity: ratings from 5 min to 24 h did not differ after cycling, though functional and resistance sessions may show early-rating inflation. A practical app rule is to prompt ≥10–30 min after the session and accept same-day entry.

### Cited Findings
- Scale: modified CR-10, 0 "Rest" to 10 "Maximal"; session load = rating × duration (min) — [Haddad et al. 2017](https://pmc.ncbi.nlm.nih.gov/articles/PMC5673663/). Polar implements the same "RPE * duration" with a 1–10 scale entered after the session [vendor] — [Polar white paper](https://www.polar.com/img/static/whitepapers/pdf/polar-training-load-pro-white-paper.pdf).
- Classic timing: Foster-lineage studies collected sRPE 30 min post-exercise, e.g., Day 2004 and Sweet 2004 — [Day 2004](https://doi.org/10.1519/R-13113.1); [Sweet 2004](https://doi.org/10.1519/14153.1).
- Christen, Foster, Porcari & Mikat 2016, IJSPP 11:1088–1093 [primary; 15 well-trained cyclists, steady-state and interval rides]. sRPE was sampled at 5, 10, 15, 20, 25, 30 and 60 min and 24 h, with "No significant differences." The authors concluded "sRPE appears to be temporally robust and is not necessarily limited to the 30-min-postexercise window" — [doi:10.1123/ijspp.2015-0438](https://doi.org/10.1123/ijspp.2015-0438).
- Uchida et al. 2014, J Sports Sci Med [boxers]: no effect of measurement time; accurate as early as 10 min — [PubMed 24570606](https://pubmed.ncbi.nlm.nih.gov/24570606/). Contrasting evidence: in high-intensity functional training, 30-min RPE was significantly lower than at 0, 10 and 20 min. Singh et al. reported sRPE increasing from 5 to 10 min after resistance training [summary in a primary paper's discussion; not opened directly] — [PMC6162408](https://pmc.ncbi.nlm.nih.gov/articles/PMC6162408/).
- Reliability in novices is weaker: ICC 0.586 in recreationally active adults new to HIFT, improving with familiarisation — [Crawford 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC6162783/). Very deconditioned people may initially struggle to use RPE charts [low-quality secondary snippet only; not cited as evidence].
- sRPE accuracy relative to HR deviates when most training is at low intensity (50–70 % HRmax) or high intensity (80–90 % HRmax) — [Borresen & Lambert 2008](https://doi.org/10.1123/ijspp.3.1.16).

### Inferences
- For a general-adult open-source app, the recommendations are:
  - Use sRPE × duration ("session effort points") as the universal load unit, with HR-based Edwards or Banister as an optional "heart-rate load" when device data exist.
  - Present weekly totals and trends descriptively, with no readiness or diagnostic claims.
  - Label the metric as a self-reported estimate and show the formula.
  - Ask for the rating with verbal anchors, ideally ≥10 min after finishing; record entry delay as provenance.
  - Allow late entry the same day, given Christen 2016.
- Daily "strain" would then be the sum of session loads. There is no validated way to add non-exercise daily activity (steps, chores) onto the sRPE scale. Keep step-based activity as a separate signal rather than inventing a conversion.
- Because sRPE and TRIMP use different units and scales, never mix them in one total without per-user calibration.

### Gaps
- No study found validating CR-10 sRPE load specifically in sedentary or older general adults across mixed daily activities, or linking it to wellness outcomes.
- I did not verify the Singh et al. resistance-training timing study or the HIFT timing study (PMC6162408) directly.
- Optimal handling of sessions shorter than ~10 min, or of all-day hikes, with sRPE was not found.
