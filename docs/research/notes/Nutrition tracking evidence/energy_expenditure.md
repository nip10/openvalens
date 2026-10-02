# Energy expenditure estimation and calorie targets (adaptive TDEE) for openhealth

Scope: adults 18+, wellness (no diagnosis). Researched 2026-10-02. Evidence-type tags used below: [Primary-trial], [Primary-model], [Systematic review], [Guideline], [Consensus report], [Vendor] (commercial material, not peer-reviewed), [Secondary] (non-authoritative web summary, lower confidence).

Research-process caveat: PMC full texts were blocked by a captcha and the web-search budget ran out partway through, so several well-known numbers are listed under Gaps instead of being cited. Do not treat a Gap entry as false. It just was not verified in this session.

## 1. Energy-balance method: what energy density to use for weight change (3,500 kcal/lb vs dynamic models)

### Takeaway

"Expenditure = intake − Δstored energy" is sound, but no single constant fits the energy content of weight change. It is low (glycogen and water dominate) in the first weeks of a deficit and rises after about 4–6 weeks. It also depends on initial body fat and how fast weight changes. For short-term tracking, a defensible approach is a composition-aware energy density (fat ≈ 39.5 MJ/kg, lean/protein much lower) or a flat constant explicitly labelled as an approximation, with wide uncertainty early on. The static "3,500 kcal/lb predicts weight loss" use of the rule is discredited for forward projection.

### Cited Findings

- Hall (2008) notes the rule is 3,500 kcal per lb, or 32.2 MJ/kg. Using a modified Forbes equation, he predicts that people with more initial body fat need a larger cumulative deficit per kg lost. Metabolizable energy densities used: glycogen 17.6 MJ/kg, protein 19.7 MJ/kg, fat 39.5 MJ/kg. [Primary-model] — [Hall 2008, Int J Obes](https://www.nature.com/articles/0803720)
- Heymsfield et al. (2012/2013, _Metabolism_), "Energy content of weight loss: kinetic features during voluntary caloric restriction". The energy content of weight lost (ΔEC/ΔW) was reported as 4,858 ± 388 kcal/kg at week 4, rising significantly to 6,041 ± 376 kcal/kg at week 6 (P < .01), with no significant change thereafter. In the Kiel cohort it was higher in women (6,804 ± 226) than men (6,119 ± 240 kcal/kg). The authors conclude that "sex-specific dynamic relative changes in body composition and related ΔEC/ΔW occur with weight loss initiation that extend for 1 month or more". [Primary-trial, adults with overweight/obesity on caloric restriction] — [Europe PMC record / PMC3810417](https://pmc.ncbi.nlm.nih.gov/articles/PMC3810417/). Caveat: the week labels come from an automated extraction of the abstract and should be checked against the full text.
- Hall et al. 2011 (_Lancet_): "the bodyweight response to a change of energy intake is slow, with half times of about 1 year". A persistent imbalance of about 30 kJ/day underlies population weight gain, and the "maintenance energy gap" is about 0.9 MJ/day. [Primary-model, validated against controlled feeding data] — [Hall et al. 2011, PMID 21872751](https://www.semanticscholar.org/paper/Quantification-of-the-effect-of-energy-imbalance-on-Hall-Sacks/fa64f465a8ede33c2b88937060cb6824f0f76ab6); [Lancet web appendix](https://www.niddk.nih.gov/-/media/Files/Labs-Branches-Sections/laboratory-biological-modeling/integrative-physiology-section/Hall-Lancet-Web-Appendix_508.pdf)
- Thomas et al. 2013 (_Int J Obes_) compared predictions with seven controlled experiments: "the 3500-kcal rule grossly overestimates actual weight loss". Its most serious error is that it ignores dynamic changes in energy balance (expenditure falls as weight falls). The authors offer a more accurate dynamic tool (Pennington). [Primary-model + validation] — [Thomas et al. 2013, PMID 23628852](https://www.researchgate.net/publication/236580644_Can_a_Weight_Loss_of_One_Pound_a_Week_be_Achieved_With_a_3,500_kcal_Deficit_Commentary_on_a_Commonly_Accepted_Rule)
- A related letter, "Why is the 3500 kcal per pound weight loss rule wrong?" (Hall & Chow, _Int J Obes_ 2013), exists. Its full text could not be retrieved. — [Nature](https://www.nature.com/articles/ijo2013112)

### Inferences

- For a back-calculated (retrospective) expenditure estimate over 2–4 week windows, the main error from a flat 7,700 kcal/kg is in the first 2–4 weeks of a new deficit or surplus. Early weight change is glycogen- and water-heavy, so a flat constant overstates the energy deficit and understates expenditure. The model should either down-weight the first weeks after a big intake change or use a lower effective density early on.
- The "3,500 kcal rule is wrong" critique mainly targets forward projection: it treats expenditure as fixed. In an adaptive estimator, expenditure is re-estimated continuously, which absorbs most of that error. The remaining error is in the energy-density constant itself.
- Pragmatic option: model Δstored energy as Δfat × 39.5 MJ/kg + Δlean × (~7.6 MJ/kg, see the MacroFactor vendor figure in section 2), with a fat fraction that depends on body fat and rate. Alternatively, use a flat ~7,700 kcal/kg and widen the uncertainty band in the first 4 weeks and after intake step-changes.

### Gaps

- The widely quoted Hall et al. 2011 rule of thumb (an energy-intake change of about 100 kJ/day leading to about 1 kg eventual weight change, half reached in about 1 year and 95% in about 3 years) appears in the paper, but this session could not verify the exact wording. Only the "half times of about 1 year" phrase was confirmed.
- The NIH Body Weight Planner methodology page was not fetched.

## 2. MacroFactor's published methodology [Vendor]

### Takeaway

MacroFactor (Stronger By Science team) has disclosed the following:

- a deterministic energy-balance back-calculation from logged intake and a "trend weight"
- a recency-weighted average for trend weight; the exact algorithm is kept secret
- composition-aware energy densities in V3
- weekly adherence-neutral check-ins
- stabilisation after about 14–30 days
- tolerance of missing days, with partial-day logging named as the key failure mode

It does not disclose its smoothing algorithm, its priors or Bayesian machinery, or its initial-estimate equations. Its accuracy claims are self-validated on a filtered cohort of engaged users.

### Cited Findings

- The estimate is "a deterministic calculation based on your calorie intake and change in trend weight", using the energy balance equation rearranged to solve for expenditure. [Vendor] — [MacroFactor help: Expenditure](https://help.macrofactorapp.com/en/articles/20-expenditure); [MacroFactor search summary](https://help.macrofactorapp.com/en/articles/26-how-should-i-interpret-changes-to-my-energy-expenditure)
- Partial-day logging is the critical vulnerability. If dinner goes unlogged, the "estimated daily energy expenditure will decrease accordingly". [Vendor] — [MacroFactor help: Expenditure](https://help.macrofactorapp.com/en/articles/20-expenditure)
- Initial estimate: "custom equations" for BMR plus "custom activity multipliers" that separate daily-life activity from purposeful exercise, described as "a rough estimate".
  - Trend weight: "an averaging approach that accounts for the influence of weight values over a pretty long time scale, while placing more weight on more recent values".
  - Daily changes in the estimate slow after "about 14-30 days (depending on how consistently you track…)".
  - Weekly check-ins adjust targets "regardless of how close you came to hitting your targets from the previous week", which is what they call adherence-neutral.
  - Stated limits: persistent weight changes unrelated to energy storage (creatine loading, major diet-composition shifts) and unusual multi-day activity spikes.
  - [Vendor] — [MacroFactor's Algorithms and Core Philosophy](https://macrofactor.com/macrofactors-algorithms-and-core-philosophy/)
- V3 algorithm:
  - energy densities of fat ≈ 39.5 MJ/kg (≈ 4,282 kcal/lb) and lean tissue ≈ 7.6 MJ/kg (≈ 824 kcal/lb)
  - deficits and surpluses now treated symmetrically
  - "1-5 days sooner" at detecting trend changes, with day-to-day updates about 35% smaller than V2
  - updates pause only if "more than three days of missing nutrition data in a seven-day period" (V2 needed 80–85% completeness)
  - imputes unlogged days with an average error of about 13%
  - the smoothing algorithm is withheld ("secret sauce")
  - [Vendor] — [MacroFactor V3 expenditure](https://macrofactor.com/expenditure-v3/)
- Accuracy claim: 748 participants from a 2025 transformation challenge with 100 days of tracking; users flagged for partial logging were excluded (<10%).
  - After 3–4 weeks, median prediction error was 1.15 lb/month vs 2.6 lb for formula TDEE, about 110 kcal/day (~4.4% of TDEE), IQR 50–185 kcal/day.
  - Over 100 days, the correlation with observed weight change was r = 0.94 vs 0.61 for formulas.
  - The page also states a "3,500 Calories per pound" assumption, which conflicts with the V3 composition-aware densities above. This is an internal inconsistency in vendor material.
  - [Vendor, self-validation, selected engaged cohort] — [MacroFactor algorithm accuracy](https://macrofactor.com/algorithm-accuracy/)
- Expenditure modifiers are a further feature (not analysed here). — [MacroFactor expenditure modifiers](https://macrofactor.com/expenditure-modifiers/)

### Inferences

- The validation measures predictive validity: does the estimate predict subsequent weight change? It does not measure agreement with doubly labelled water (DLW). That is the right metric for a self-consistent adaptive target, but it is not evidence that the number equals true TEE (see section 4).
- openhealth can openly implement equivalent behaviour: an energy-balance back-calculation, a recency-weighted trend, adherence-neutral weekly check-ins, a pause rule on missing-data density, and explicit handling of partial days. Being transparent about the method, unlike the vendor's "secret sauce", is a differentiator that fits the repo's "deterministic summaries and explicit confidence" rule.

### Gaps

- I found no public whitepaper or peer-reviewed validation of MacroFactor's algorithm. Whether it uses Bayesian updating or a prior anchored on the formula estimate is not disclosed.

## 3. Weight-trend smoothing, noise sources, minimum data, missed days

### Takeaway

Exponential smoothing (Hacker's Diet, α ≈ 0.1) is the classic, transparent baseline. MacroFactor uses an undisclosed recency-weighted average. Menstrual-cycle fluid shifts of about 0.5 kg are documented, and the dynamic composition data show glycogen/water effects in the first weeks. Vendor experience suggests about 2–4 weeks of consistent logging before the estimate stabilises. I found no peer-reviewed minimum-data threshold.

### Cited Findings

- The Hacker's Diet uses an exponentially smoothed moving average with smoothing constant 0.9 (that is, 10% weight on today's reading). The trend slope gives the calorie balance as weekly Δlb × 3,500 / 7. A monthly trend difference ÷ 4 approximates the weekly rate. [Practitioner/grey literature, John Walker] — [The Hacker's Diet: Signal and Noise](https://www.fourmilab.ch/hackdiet/e4/signalnoise.html)
- Kanellakis et al. 2023 found body weight was 0.450 kg higher during menstruation than in the first week of the cycle, attributed to a 0.474 kg increase in extracellular water. The authors note earlier studies were methodologically inconsistent. [Primary observational, women] — [Kanellakis et al. 2023, Am J Hum Biol](https://onlinelibrary.wiley.com/doi/full/10.1002/ajhb.23951)
- A web summary claims 0.5–2.3 kg luteal/menstrual gain. [Secondary, unverified; not traced to a primary source] — [search summary of consumer pages, e.g. The Lowdown](https://thelowdown.com/blog/weight-gain-period)
- Vendor data points (cited in section 2): stabilisation after about 14–30 days, a pause rule of more than 3 missing nutrition days per 7, and a smoothing horizon of "two to four weeks" (from a third-party summary). — [MacroFactor core philosophy](https://macrofactor.com/macrofactors-algorithms-and-core-philosophy/); [MacroFactor V3](https://macrofactor.com/expenditure-v3/)
- The energy content of weight change keeps shifting for 1 month or more after a deficit starts (Heymsfield, section 1). Early trend slopes therefore reflect glycogen and water as well as fat. — [PMC3810417](https://pmc.ncbi.nlm.nih.gov/articles/PMC3810417/)

### Inferences

- Use an EMA (α ≈ 0.1/day on available weigh-ins, which needs no fixed window) or a local-level Kalman filter. A Kalman filter handles irregular weigh-in spacing naturally and yields a variance for the slope, which can drive a confidence/readiness signal. This is an engineering recommendation, not evidence-based.
- Suggested readiness gating (design choice, not validated):
  - show only a formula-based estimate until there are at least 14 days of complete-day logging and at least about 8–10 weigh-ins
  - label the estimate as "provisional" until about 28 days
  - pause updates when more than 3 of the last 7 days lack complete intake (mirrors the vendor rule)
- Treat unlogged days as missing, not zero. Ask users to mark days as "complete" so partial days can be excluded. Partial logging biases expenditure downward (vendor, section 2).
- Offer an optional cycle-phase annotation so users understand menstrual water shifts. Smoothing over at least 2 cycles-worth of data dampens the effect but does not remove it.

### Gaps

- No peer-reviewed study found that defines the minimum days of intake logging and weigh-ins for an intake-plus-weight TEE estimate to reach a given accuracy.
- No primary data retrieved on day-to-day body-weight variability (SD in kg) in free-living adults, or on sodium/carbohydrate-driven water shifts.

## 4. Intake under-reporting and robustness of the adaptive method

### Takeaway

Self-reported intake is systematically low, sometimes severely: about 47% under-reporting in "diet-resistant" adults with obesity, measured against DLW. An adaptive estimator stays internally consistent under a stable proportional or constant bias, because the estimated "expenditure" absorbs the bias. Targets expressed in the same logged units then still produce the intended weight change. The estimator is not robust to time-varying bias (for example, logging diligence fading), to partial-day logging, or to presenting the number as true physiological TEE.

### Cited Findings

- Lichtman et al. 1992 (_NEJM_) studied 10 subjects with self-reported "diet resistance". They under-reported actual food intake by an average of 47 ± 16% and over-reported physical activity by 51 ± 75%. TEE was measured by DLW over 14 days (accurate to about ±5%). [Primary, small n, adults with obesity] — [PubMed 1454084](https://pubmed.ncbi.nlm.nih.gov/1454084/)
- Schoeller 1990 (_Nutrition Reviews_): "Reported intakes tend to be lower than expenditure and thus are often underestimates of true habitual energy intake." [Narrative review] — [Schoeller 1990, PMID 2082216](https://pubmed.ncbi.nlm.nih.gov/2082216/)
- A 2025 predictive equation derived from 6,497 DLW measurements was built specifically to detect erroneous self-reported energy intake. [Primary, large DLW database] — [PMC11772230](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11772230/) (title only verified)
- Vendor: users "don't need to log all of their food with perfect accuracy", but partial logging is "the single cardinal sin". [Vendor] — [MacroFactor algorithm accuracy](https://macrofactor.com/algorithm-accuracy/)

### Inferences

- Math: if logged intake = k × true intake (or true − c) and the bias is stable, the back-calculated expenditure becomes k × TEE (or TEE − c). A target set as "estimated expenditure − deficit" in logged units then yields the intended true deficit (exactly for constant c, approximately for proportional k). This is why the method is called bias-robust.
- The estimator is not robust to:
  - (a) bias that changes over time, such as logging less carefully during a diet, eating out more, or starting or stopping a food-weighing scale. The estimate drifts and targets chase it.
  - (b) partial days.
  - (c) users comparing the number with a wearable or a lab.
- UI copy should call it "estimated maintenance intake (in your logging units)" rather than "your metabolism".
- Under-reporting also makes initial formula estimates look wrong to users. Their "maintenance" appears lower than predicted. The app should not interpret this clinically (no "slow metabolism" messaging).

### Gaps

- I found no peer-reviewed DLW study quantifying under-reporting specifically among nutrition-app or barcode-scanner users. The magnitude in app users is unknown from this session's sources.

## 5. Predictive equations for initial estimates

### Takeaway

Mifflin-St Jeor is the best-supported RMR equation for healthy non-obese and obese adults (Frankenfield 2005 systematic review), but it has notable individual errors. NASEM 2023 EER equations come straight from DLW TEE data (about 2,358 adults) and avoid separate activity multipliers. Their prediction standard error is still about 240–340 kcal/day, so any initial estimate needs an uncertainty band of roughly ±10–15%. Pontzer 2021 supports no age term for size-adjusted TEE from 20 to 60.

### Cited Findings

- Frankenfield, Roth-Yousey & Compher 2005 (_J Am Diet Assoc_, systematic review) found "the Mifflin-St Jeor equation was the most reliable, predicting RMR within 10% of measured in more nonobese and obese individuals than any other equation". However, "noteworthy errors and limitations exist when it is applied to individuals". [Systematic review] — [PMID 15883556](https://pubmed.ncbi.nlm.nih.gov/15883556/)
- NASEM _Dietary Reference Intakes for Energy_ (2023):
  - Adult EER equations come from a DLW database of 1,016 men and 1,342 women aged 19 and over (IAEA, IOM, SOLNAS, CNRC).
  - PAL categories are Inactive 1.00–<1.53, Low active 1.53–<1.68, Active 1.68–<1.85, and Very active 1.85–<2.50.
  - R² is 0.73 for men and 0.71 for women; RMSE is 339 kcal/d for men and 246 kcal/d for women.
  - The SE of predicted values at average covariates (active PAL) is 342 kcal/d for men and 241 kcal/d for women.
  - The example published equation for men 19+ (inactive) is EER = 753.07 − 10.83×age + 6.50×height(cm) + 14.10×weight(kg).
  - [Consensus report] — [NASEM 2023 ch. 7](https://www.nationalacademies.org/read/26818/chapter/7); [NASEM highlights](https://nap.nationalacademies.org/resource/26818/DRIs_for_Energy_Highlights.pdf); [NCBI Bookshelf](https://www.ncbi.nlm.nih.gov/books/NBK588659/)
- Pontzer et al. 2021 (_Science_) pooled DLW data from 6,421 people aged 8 days to 95 years in 29 countries. Size-adjusted TEE is stable from 20 to 60 years and declines in older adults. [Primary, large pooled DLW] — [Science 10.1126/science.abe5017](https://www.science.org/doi/10.1126/science.abe5017); [accepted manuscript](https://researchonline.ljmu.ac.uk/id/eprint/15386/1/Pontzer%20et%20al%202021%20Accepted.pdf)
- RMR equations perform worse in subgroups such as athletes and older adults with obesity, where systematic reviews and validation studies exist. [Systematic review/meta-analysis] — [Athletes SR/MA, Sports Med 2023](https://link.springer.com/article/10.1007/s40279-023-01896-z); [older adults with obesity](https://pmc.ncbi.nlm.nih.gov/articles/PMC9761489/)
- MacroFactor uses proprietary BMR equations and activity multipliers. [Vendor] — [MacroFactor core philosophy](https://macrofactor.com/macrofactors-algorithms-and-core-philosophy/)

### Inferences

- Recommended seed: NASEM 2023 EER, using the user's self-selected PAL category with descriptive anchors, with Mifflin-St Jeor × activity factor as an alternative. Display it as a range (for example ± 1 SE, about ±250–350 kcal). It can also serve as a weak prior that the adaptive estimate overrides within weeks.
- Katch-McArdle/Cunningham need lean body mass, which consumer bio-impedance scales measure poorly. Only use them when the user has a credible body-composition source (DEXA), and label accordingly.
- Self-selected activity multipliers are a major error source: PAL categories span about 0.15 each, and users misclassify themselves. This is another reason to move quickly to the adaptive estimate.

### Gaps

- The exact percentage of individuals within ±10% for each equation (Mifflin, Harris-Benedict, Owen, WHO/FAO/UNU) in Frankenfield 2005 was not retrieved. Only the qualitative conclusion is verified.
- No primary data retrieved on activity-multiplier error versus DLW, or on wearable TEE error beyond a vendor claim that 82% of wearables have >10% error ([MacroFactor](https://macrofactor.com/algorithm-accuracy/), Vendor).
- Cunningham/Katch-McArdle accuracy data not retrieved.

## 6. Adaptive thermogenesis / metabolic adaptation

### Takeaway

After weight loss, TEE falls more than predicted from lost mass, mostly in non-resting (activity) expenditure. The size of this "adaptive" component varies widely between individuals, roughly −340 to +350 kcal/day in one large sample, and it can persist long term in people maintaining reduced weight. An adaptive estimator detects this automatically, so targets will tend to drift down during sustained loss.

### Cited Findings

- Rosenbaum & Leibel (_Int J Obes_ 2010 review, "Adaptive thermogenesis in humans"): after weight loss, TEE, especially at low activity levels, is lower than predicted by changes in body weight and composition. The reduction is mainly in non-resting energy expenditure. [Narrative review of controlled inpatient studies] — [Rosenbaum & Leibel 2010](https://www.nature.com/articles/ijo2010184)
- Reductions persist over an extended period, "perhaps indefinitely", in subjects maintaining reduced weight. [Primary] — [Rosenbaum et al. 2008, AJCN, "Long-term persistence of adaptive thermogenesis…"](https://www.sciencedirect.com/science/article/pii/S000291652323302X)
- Inter-individual range: among 227 subjects, metabolic adaptation ranged from −337 to +352 kcal/d, and only about 55% showed reductions greater than 40 kcal/d. One study found RMR fell 0.27 MJ/d (~65 kcal/d) more than calculated after moderate weight loss. [From a review via search summary; the original study attribution was not verified] — [AJCN "Weight loss, weight maintenance, and adaptive thermogenesis"](<https://ajcn.nutrition.org/article/S0002-9165(22)06548-0/fulltext>); [AJCN "On adaptive thermogenesis: just another weight-loss tale?"](<https://ajcn.nutrition.org/article/S0002-9165(22)00885-1/fulltext>)
- Vendor: if weight loss slows below what the logged deficit predicts, the algorithm infers lower expenditure and adjusts targets. [Vendor] — [MacroFactor](https://macrofactor.com/macrofactors-algorithms-and-core-philosophy/)

### Inferences

- The adaptive estimator lumps three things into "expenditure": true adaptation, the lower cost of a smaller body, and changes in logging bias. It cannot separate them, so UI copy should not attribute a decline to "metabolic adaptation" specifically.
- Target-update policy (design suggestions):
  - update weekly (adherence-neutral)
  - cap the change per check-in (for example ≤ about 100–150 kcal/week, or a percentage) to avoid chasing noise
  - never let automatic updates push targets below the minimum-intake floor in section 7; instead, suggest a maintenance phase or professional input
- For the floor's purpose, the adaptation range of ±350 kcal/d supports showing users that maintenance after weight loss may sit below formula predictions.

### Gaps

- The precise Leibel/Rosenbaum percentages (for example, the often-quoted ~10–15% TEE reduction beyond prediction after 10% weight loss) were not verified in this session.
- Hall's analyses of adaptation (for example, the Biggest Loser follow-up) were not retrieved.

## 7. Safe rates of weight change, minimum intakes, lean-mass preservation

### Takeaway

Guidelines converge on a moderate deficit: about 500–1,000 kcal/day (NHLBI: 1–2 lb/week) or about 600 kcal/day (NICE). Very-low-calorie diets (≤800 kcal/day) are not for routine use and only with clinical support for up to 12 weeks (NICE). NHLBI also says not below 800 kcal/day. Resistance training and higher protein preserve lean mass during restriction.

### Cited Findings

- NHLBI Practical Guide / Clinical Guidelines: reductions of 500–1,000 kcal/day "will produce a recommended weight loss of 1 to 2 pounds per week". Eating plans of 1,000–1,200 kcal/day are suggested for most women and 1,200–1,600 kcal/day for men. Diets should not be "too low (less than 800 kcal/day)". [Guideline, US, 1998/2000 era] — [NHLBI Practical Guide](https://www.nhlbi.nih.gov/files/docs/guidelines/prctgd_c.pdf); [NCBI Bookshelf summary](https://www.ncbi.nlm.nih.gov/books/NBK2009/)
- NICE NG246 (Overweight and obesity management, 2025):
  - Diets with a 600 kcal/day deficit, or low-fat diets, combined with expert support and intensive follow-up, are recommended for sustainable weight loss.
  - Low-calorie diets of 800–1,600 kcal/day can be considered but are less likely to be nutritionally complete.
  - Do not routinely use VLCDs (≤800 kcal/day). Only consider them with ongoing support, as part of a multicomponent strategy, for at most 12 weeks, in people with obesity who have a clinically assessed need to lose weight rapidly.
  - [Guideline, UK] — [NICE NG246 via NCBI Bookshelf](https://ncbi.nlm.nih.gov/books/NBK588750/); [Medscape summary](https://reference.medscape.com/cc2/p10/overweight-and-obesity-management-adults-2025a10000uq)
- A web page states the NHS figure of 0.5–1 kg/week. [Secondary, not the NHS primary page] — [bmicalculatornhs.co.uk](https://bmicalculatornhs.co.uk/safe-rate-of-weight-loss-per-week.html)
- Lean mass:
  - In older adults with obesity, adding resistance training prevented about 93.5% of the lean-mass loss caused by caloric restriction. [SR/MA] — [PMC5946208](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5946208/)
  - A network meta-analysis found resistance training at all intensities (and moderate combined exercise) most effective for maintaining lean mass during restriction. [SR/NMA] — [PMC12158682](https://pmc.ncbi.nlm.nih.gov/articles/PMC12158682/)
  - Protein of 1.6–2.4 g/kg/day is suggested for lean-mass retention in active people during weight loss. [Secondary summary; primary source not verified] — [search summary](https://www.measureup.com.au/the-role-of-resistance-training-in-preserving-lean-mass-during-weight-loss/)
- Composition of weight lost depends on initial body fat: leaner people lose a larger share as lean mass. [Primary-model] — [Hall 2008](https://www.nature.com/articles/0803720)

### Inferences

- Product guardrails for a wellness app (no diagnosis):
  - Cap goal-rate options at about 1% of body weight/week (≈ 0.5–1 kg/week for most adults). Note that 1%/week is a design heuristic, not a guideline number. The guideline anchors are 0.5–1 kg (NHS/NICE context) and 1–2 lb/week (NHLBI).
  - Never set an automatic target below about 1,200 kcal/day for women or 1,500 kcal/day for men. These are common heuristics; NHLBI's own range goes down to 1,000. In any case, never set a target at or below 800 kcal/day. Below the floor, show a "consult a professional" message instead of a number.
  - Block or warn on goals that imply BMI < 18.5, and on rapid-loss settings for users who report pregnancy or lactation or are under 18 (out of scope).
  - Pair deficit goals with prompts for protein and resistance training. Default the rate to slower for users with lower body fat.

### Gaps

- The NHS "lose weight safely" primary page and the current CDC/NIH wording (1–2 lb/week) were not fetched directly. The 1,200/1,500 kcal floors are industry heuristics; I found no guideline source for them in this session.
- Peer-reviewed evidence on rate of loss vs lean-mass retention in non-obese/resistance-trained adults (for example, Garthe 2011, Helms) was not retrieved.
