# Effects of Normative/Percentile Health Comparisons and Privacy of Community Benchmarks (openhealth)

Scope: whether and how to show "top 10% for your age" / "+10% vs 20-year-olds" comparisons to adults (18+) in a self-hosted, non-diagnostic wellness app, and whether an opt-in community-aggregate benchmark is safe. Reference-dataset availability is out of scope (another researcher owns it). Research done 2026-10-02. Source-access notes: several publisher pages (ScienceDirect, SAGE, JMIR full text, PubMed) returned 403/empty to the fetch tool, so a few findings rely on search-result abstracts. These are marked "(abstract/snippet only)". Citations marked "(not re-fetched this session)" are well-known primary works cited from prior knowledge with their DOI/URL. The report writer should spot-check them before quoting exact numbers.

## Q1. Evidence on social/normative comparison feedback in health behaviour: benefits vs harms

### Takeaway

Normative feedback can change behaviour, but evidence for physical-activity apps is mixed and depends on the person. Comparisons with people far ahead of you can lower motivation. Descriptive-norm messages can "boomerang" people who are already above the norm back toward average, and adding an injunctive ("this is good") message seems to reduce that. Body-metric tracking is consistently _associated_ with disordered eating and compulsive exercise, but experimental studies have not shown it causes them.

### Cited Findings

**Social-norms / personalised normative feedback (PNF), mostly addiction research in students:**

- PNF works by highlighting the gap between perceived and actual peer norms, set against the person's own behaviour. It uses descriptive norms (how common a behaviour is) and/or injunctive norms (whether peers approve of it). A systematic review and meta-analysis of PNF across addictions (alcohol, gambling, etc.) is available. Population: mainly student/young adult samples. — [PNF across addictions meta-analysis, PMC8016245](https://pmc.ncbi.nlm.nih.gov/articles/PMC8016245/) (abstract/snippet only; pooled effect sizes not retrieved)
- A secondary analysis of four alcohol PNF studies found no boomerang effect in students who drank below the reported norm. Adding an injunctive message to normative feedback can partly remove boomerang effects. — [Frontiers in Psychology 2018](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2018.02180/full) (snippet only)
- Boomerang effect: people whose behaviour is already desirable move back toward the norm after learning that the desirable behaviour is less common than they thought. This is documented in energy-use studies and was the subject of a registered systematic-review protocol on descriptive-norm backfire. — [Systematic Reviews protocol, 2020](https://systematicreviewsjournal.biomedcentral.com/articles/10.1186/s13643-020-01533-0); [MDPI Sustainability 2018, "A Social Norms Intervention Going Wrong"](https://www.mdpi.com/2071-1050/10/8/2848)
- The classic demonstration is Schultz et al. 2007 (household energy). Above-average consumers who got only descriptive feedback increased use. Adding an injunctive emoticon (a smiley face) prevented that. — Schultz, Nolan, Cialdini, Goldstein & Griskevicius, _Psychological Science_ 2007, [doi:10.1111/j.1467-9280.2007.01917.x](https://doi.org/10.1111/j.1467-9280.2007.01917.x) (not re-fetched this session; energy domain, not health)

**Social comparison in physical-activity apps (Festinger-type upward/downward comparison):**

- In daily-assessment studies of insufficiently active college students using Fitbit, participants chose upward comparison targets (people with more steps) more often than downward ones. Only some choices of either kind were linked to better motivation or activity. Motivation _fell_ on days when participants picked upward targets whose step counts were furthest from their own. — [Arigo et al., JMIR Human Factors 2023;10:e41239](https://humanfactors.jmir.org/2023/1/e41239/) (abstract/snippet only; population: inactive US college students, short 7–9 day designs)
- There is a scoping meta-review of social comparison features in physical-activity promotion apps. — [JMIR 2020;22(3):e15642](https://www.jmir.org/2020/3/e15642/) (full text could not be retrieved; findings not verified here)
- There is also a Fitbit-challenge evaluation of step-based social comparison. — [Stepping Up, J Technol Behav Sci 2022](https://link.springer.com/article/10.1007/s41347-022-00241-x) (not fetched)
- There is a pilot RCT that "deconstructs" Fitbit features in inactive adults. — [PubMed 38996332](https://pubmed.ncbi.nlm.nih.gov/38996332/) (not fetched; results unknown)

**Harms with body/diet/exercise tracking (closest evidence for body-metric comparisons):**

- A 2025 systematic review covered 27 studies (N=10,584, published 2016–2024, mostly US undergraduate women). Fitness/diet tracker use was linked to greater global disordered eating in 7 of 8 studies, more dietary restraint in 5 studies, and more excessive exercise in all 7 studies that measured it. Linardon & Messer 2019 found large effects in MyFitnessPal users: d=1.06 for restraint and d=0.91 for global disordered eating. — [Moody et al., Eur Eat Disord Rev 2025;33(6):1288–1313, doi:10.1002/erv.70006](https://pmc.ncbi.nlm.nih.gov/articles/PMC12547374/)
- In the same review, **all experimental/RCT studies found no significant effect** of assigned tracker use on disordered eating. The authors write: "it is currently not possible to conclude if they increase disordered eating, or the direction of this relationship". Reverse causation (people at risk choosing trackers) is plausible. — [Moody et al. 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12547374/)
- Motivation matters. Using trackers for weight/shape reasons was linked to more restraint and purging than using them for health/fitness reasons (Plateau et al. 2018). People with an eating-disorder diagnosis were about 5 times more likely to use activity trackers (O'Loughlin et al. 2023). — [Moody et al. 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12547374/)
- Levinson et al. 2017 studied 105 people with eating disorders. Of the MyFitnessPal users, 83% said the app at least somewhat contributed to their eating disorder, and 30.3% said it "very much" contributed. — [via Moody et al. 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12547374/). Note: a search snippet reported this as "almost three quarters" of female participants. The difference is probably due to the denominator (all participants vs users only), so the writer should cite the 83%-of-users figure with that caveat. — [ResearchGate record](https://www.researchgate.net/publication/319194941_My_Fitness_Pal_calorie_tracker_usage_in_the_eating_disorders)
- A qualitative study of people with eating disorders on how diet/fitness apps affect their behaviour is available. — [BJPsych Open](https://www.cambridge.org/core/journals/bjpsych-open/article/effects-of-diet-and-fitness-apps-on-eating-disorder-behaviours-qualitative-study/2D1EE739D97AB3EFC6573835E4C527BD) (not fetched)
- A longitudinal study of fitness tracking and disordered eating in college-aged women is available. — [Berry et al., Int J Eat Disord 2024](https://onlinelibrary.wiley.com/doi/full/10.1002/eat.24192) (not fetched)

### Inferences

- Comparing someone to a distant upper cohort ("vs 20-year-olds", "top 10%") for a person far below it is the configuration most likely to demotivate, based on the Arigo 2023 distance effect. Comparisons to self-history or to a near/attainable reference are likely safer.
- Descriptive percentile feedback alone, with no evaluative framing, risks pulling high performers toward average (boomerang). Feedback should pair the number with an injunctive or goal-based message ("in the range associated with good health") rather than rank alone.
- Weight, body-fat and calorie metrics carry the clearest signal for disordered eating, even though causation is not shown. Comparison for these metrics should be off by default or omitted.
- Almost none of this evidence comes from adults outside student samples or from percentile-for-age displays specifically. Effects for openhealth's adult users are extrapolated.

### Gaps

- I found no trial that tests "percentile for age" displays (e.g. VO2max/Garmin/Whoop-style "top X% for your age") on behaviour or wellbeing in adults.
- Pooled effect sizes from the PNF meta-analysis and the JMIR 2020 meta-review could not be retrieved (fetch blocked).
- I found no Strava-specific peer-reviewed comparison study in this session.

## Q2. Risk communication: percentiles vs ranges vs "within recommended range"; numeracy

### Takeaway

Many adults, including educated ones, misread percentages and probability formats. Low numeracy predicts worse comprehension. Simple categorical framing ("within recommended range") plus natural frequencies is generally easier to understand than raw percentages. Percentile ranks are a form people often confuse with percentages or with absolute risk.

### Cited Findings

- 16% of highly educated people answered basic risk-magnitude questions wrongly (e.g. which is larger: 1%, 5% or 10%). People with low numeracy did not recognise "10 out of 100" and "10%" as the same and rated "10%" as lower risk. Natural frequencies improved understanding for people with low numeracy. — ["Numeracy and Communication with Patients: They Are Counting on Us" (Perspectives article, PMC2596505; authors not verified this session)](https://europepmc.org/api/getPdf?pmcid=PMC2596505) (snippet only)
- Natural frequencies help limited-numeracy readers understand relative risk reduction better than percentages. Avoid "1-in-x" formats ("20 out of 100" is better than "1 in 5"). — [Systematic review of risk communication for limited health literacy, Patient Educ Couns 2023](https://www.sciencedirect.com/science/article/pii/S0738399123003245) (snippet only)
- Math anxiety, subjective numeracy and objective numeracy each relate to health-risk comprehension. — [PMC7502983](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC7502983/) (not fetched)
- Peters et al. 2006 found that less numerate people are more affected by framing and by irrelevant affective information when judging numbers. — Peters, Västfjäll, Slovic et al., _Psychological Science_ 2006, [doi:10.1111/j.1467-9280.2006.01720.x](https://doi.org/10.1111/j.1467-9280.2006.01720.x) (not re-fetched this session)
- Lipkus et al. 2001 found substantial innumeracy even in highly educated samples (Lipkus numeracy scale). — _Medical Decision Making_ 2001;21(1):37–44, [doi:10.1177/0272989X0102100105](https://doi.org/10.1177/0272989X0102100105) (not re-fetched this session)
- Gigerenzer et al. recommend absolute risks and natural frequencies, not relative risks or single-event probabilities ("statistical illiteracy"). — _Psychological Science in the Public Interest_ 2007;8(2):53–96, [doi:10.1111/j.1539-6053.2008.00033.x](https://doi.org/10.1111/j.1539-6053.2008.00033.x) (not re-fetched this session)

### Inferences

- "Top 10% for your age" invites two misreadings. People may read it as "10% better" (percentage vs percentile confusion), and they may assume it means a health outcome or risk level, when it is really a rank within a reference sample that may not be representative.
- "+10% vs 20-year-olds" is a relative-difference format that rests on a reference group the user can't see. Gigerenzer-style guidance prefers absolute values with context.
- A safer default display: the user's value; a shaded band showing the guideline/healthy range (where one exists); an optional "typical range for adults your age and sex (middle 50%)" band; and plain-language category text. Percentile rank would be secondary and opt-in.

### Gaps

- I found no study that directly measures how lay adults interpret _percentile ranks_ of their own biomarkers or fitness (as opposed to probabilities). The percentile-specific misreading is inferred from general numeracy findings.

## Q3. BMI and body-composition comparisons; weight stigma; ED guidance for apps

### Takeaway

Weight stigma harms health independently of BMI, and internalised weight bias predicts worse self-monitoring and weight outcomes. Body-tracking apps are correlated with disordered eating (see Q1). No study was found that tests BMI/body-fat percentile feedback in apps directly. Precaution points toward not ranking weight or body composition.

### Cited Findings

- Weight stigma harms health "over and above objective BMI". It is prospectively linked to higher mortality and chronic disease, and may itself drive weight gain through obesogenic pathways (review). — [Tomiyama et al., BMC Medicine 2018 (PMC6092785)](https://pmc.ncbi.nlm.nih.gov/articles/PMC6092785/) (snippet only)
- Among adults in weight management, internalised weight-stigma scores were negatively linked to weight loss, **self-monitoring**, eating self-efficacy, body image and mental QoL. They were positively linked to weight gain, weight cycling, stress and eating to cope (cross-sectional). — [PMC7646152](https://pmc.ncbi.nlm.nih.gov/articles/PMC7646152) (snippet only)
- 70.6% of participants in one sample reported at least one stigmatising healthcare experience in the past year. — [PMC6934430](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC6934430/) (snippet only)
- Using trackers for weight/shape motivation is linked to more restraint and purging than using them for health motivation. Weight/shape-concern associations are strongest under weight motivation. — [Moody et al. 2025](https://pmc.ncbi.nlm.nih.gov/articles/PMC12547374/)

### Inferences

- A "top X% for BMI/body fat" display effectively scores body size. It is likely to trigger weight-stigma and weight/shape-motivation pathways, and it gives little actionable benefit.
- Recommended: no percentile ranking for weight, BMI or body fat. If shown at all, show a value against a clinical reference range with neutral language. Give a global "hide body metrics / comparisons" setting.

### Gaps

- I did not retrieve NEDA's specific guidance on apps or tracking in this session. The writer should not claim NEDA positions without checking.
- I found no direct experimental evidence on BMI/body-fat percentile feedback in adult apps.

## Q4. "Fitness age" / "heart age" framing

### Takeaway

Heart age is the best-studied "age framing". One large workplace RCT reported better risk-factor outcomes with a heart-age tool. Experimental work shows heart age is more emotionally impactful and often pushes low-risk people into perceiving higher risk, with mixed credibility. A 2021 systematic review rates the evidence as mixed. "Fitness age" has a validated basis (Nes, HUNT), but I found no outcome trials of showing it.

### Cited Findings

- Lopez-Gonzalez et al. 2015 (Eur J Prev Cardiol) randomised 2,844 employees to a web-based interactive heart-age tool, verbal percentage risk, or usual care for 1 year. The intervention groups had more physical activity and less smoking, BP, cholesterol, weight and waist than control, with larger benefits in the heart-age arm. — as summarised by the [JMIR Cardio 2021 systematic review (doi:10.2196/31056)](https://doi.org/10.2196/31056) (abstract/snippet only)
- In an experimental study (Bonner et al. 2015, Med Decis Making), low-risk participants interpreted heart age as a higher-risk category more often than absolute risk (47% vs 23%). — [search abstract for Bonner et al. 2015, doi:10.1177/0272989X15597224](https://doi.org/10.1177/0272989x15597224) (snippet only; I recall this study also reported lower credibility and more negative emotion for heart age, but could not verify that here, so treat as unverified)
- Qualitative work on online heart-age calculators: users often distrusted the result ("I don't believe it") yet still felt prompted to act. — [Bonner et al., JMIR 2014, doi:10.2196/jmir.3190](https://doi.org/10.2196/jmir.3190) (title-level only)
- An RCT on risk-communication formats (EFFRICO) is available. — [PMC11213401](https://pmc.ncbi.nlm.nih.gov/articles/PMC11213401) (not fetched)
- Fitness age: Nes et al. 2014 (MSSE) showed that a non-exercise estimated cardiorespiratory fitness model predicts long-term mortality in HUNT. The model uses age, waist, leisure-time activity and resting HR, based on 4,600+ healthy adults (Nes 2011). — [NTNU CERG fitness calculator](https://www.ntnu.edu/cerg/vo2max); [Nes et al. 2011 Semantic Scholar record](https://www.semanticscholar.org/paper/Estimating-V%C2%B7O-2peak-from-a-nonexercise-prediction-Nes-Janszky/cff3dbccaa041b33f2b0a34a9554c17a9d2340e1)
- JBS3 (UK Joint British Societies) uses heart age as a lifetime-risk communication tool. — referenced in the [JMIR Cardio 2021 review](https://doi.org/10.2196/31056) (not independently verified this session)

### Inferences

- An age-based framing ("your fitness is like a 35-year-old's") is motivating and memorable, but it inflates perceived risk in low-risk people. The predictive model (e.g. Nes) is validated for mortality; the effect of _showing_ fitness age on behaviour is not.
- "+10% vs 20-year-olds" is a variant of age framing with an aspirational upper reference. It inherits both the motivational upside and the distortion risk.

### Gaps

- I found no RCT of displaying "fitness age" to users.
- I couldn't get the JMIR Cardio 2021 review's overall conclusions or number of studies (fetch blocked).

## Q5. Privacy limits of k-anonymity, differencing and small cohorts for health aggregates

### Takeaway

Aggregates are not automatically anonymous. Releasing many accurate statistics allows the underlying records to be reconstructed (Dinur–Nissim). The US Census Bureau showed this at scale. Repeated percentile releases on a changing cohort allow differencing (before and after one user joins). k-thresholds limit singling out but don't stop inference or differencing. In small cohorts these attacks are trivial.

### Cited Findings

- Dinur and Nissim showed that releasing enough sufficiently accurate aggregate statistics (even noisy ones) lets an attacker reconstruct the underlying database. — [Kamath CS860 lecture notes on reconstruction attacks](https://www.gautamkamath.com/CS860notes/lec2.pdf); [Toronto CSC2412 notes](https://www.cs.toronto.edu/~anikolov/CSC2412F20/notes/reconstruction.pdf)
- The US Census Bureau reconstructed microdata exactly for 46% of the population (71% allowing age ±1) from published 2010 tables. Linking with commercial data re-identified over 50 million people by name. This led to differential privacy for the 2020 Census. — [arXiv 2111.04671, "Equity and Privacy"](https://arxiv.org/pdf/2111.04671); [Census Bureau NCSL webinar 2020](https://www2.census.gov/about/policies/2020-03-05-differential-privacy.pdf)
- Article 29 WP Opinion 05/2014 says effective anonymisation must prevent **singling out, linkability and inference**. It reviews aggregation, k-anonymity, l-diversity, t-closeness and differential privacy, and treats each as having residual risk. — [WP216 PDF](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2014/wp216_en.pdf); [summary](https://itlaw.fandom.com/wiki/Opinion_05/2014_on_Anonymisation_Techniques)
- The ICO notes that the NHS standard sets k=5 for "strong anonymisation", and that people can be singled out within small contexts (e.g. year of birth within a family). — [ICO, How do we ensure anonymisation is effective?](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/how-do-we-ensure-anonymisation-is-effective/)
- Homer et al. 2008 showed that an individual's membership in a cohort could be detected from _aggregate_ allele frequencies. NIH then pulled aggregate GWAS data from open access. — _PLoS Genetics_ 2008, [doi:10.1371/journal.pgen.1000167](https://doi.org/10.1371/journal.pgen.1000167) (not re-fetched this session)
- Sweeney showed that ZIP code, birth date and sex uniquely identify most of the US population. Narayanan & Shmatikov de-anonymised Netflix ratings using a small amount of auxiliary data. — Sweeney 2000 ("Simple Demographics Often Identify People Uniquely", CMU Data Privacy Working Paper 3); Narayanan & Shmatikov, IEEE S&P 2008, [doi:10.1109/SP.2008.33](https://doi.org/10.1109/SP.2008.33) (not re-fetched this session)

### Inferences

- A threshold such as k≥30 suppresses tiny cells, but **it does not stop differencing**. If the benchmark is recomputed when one new member joins, the change in the mean or percentile exposes that member's value. The same applies to overlapping age-band/sex queries.
- Percentiles are order statistics. With small n, the min/max/quantiles may _equal_ an individual's actual value.
- Because health metrics are special-category data and the attributes are quasi-identifiers (age, sex, household), inference risk persists even when singling out is blocked.

### Gaps

- I found no published analysis of differencing attacks specific to consumer fitness-percentile features.

## Q6. Differential privacy for health statistics: practice and epsilon guidance

### Takeaway

DP is the only approach here with formal guarantees against differencing and reconstruction. It requires managing a cumulative privacy budget, and deployed values vary a lot. Apple's per-day ε=16 drew academic criticism. With small n, DP noise large enough to protect anyone makes percentiles useless.

### Cited Findings

- Epsilon bounds how much any one person's data can change the output. Low ε means outputs are hard to reconstruct; high ε means reconstruction is easy. — [Kamath lecture notes](https://www.gautamkamath.com/CS860notes/lec2.pdf); [Census Formal Privacy Methods](https://www2.census.gov/programs-surveys/decennial/2020/program-management/planning-docs/privacy-methods-2020-census.pdf)
- Apple's macOS 10.12 local DP used ε=1–2 per datum but allowed up to **ε=16 per day** across four uses. The budget renewed daily, so total loss grew with days enrolled. The authors called this "significantly higher than what is commonly considered reasonable in academic literature". — [Tang, Korolova et al. 2017, arXiv:1709.02753](https://arxiv.org/pdf/1709.02753)
- The ICO describes DP as a way to measure how much is revealed about a person and to decide how much noise to add. — [ICO anonymisation guidance](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/how-do-we-ensure-anonymisation-is-effective/)
- Foundational theory: Dwork & Roth, _The Algorithmic Foundations of Differential Privacy_ (2014), [PDF](https://www.cis.upenn.edu/~aaroth/Papers/privacybook.pdf) (not re-fetched this session)

### Inferences

- Practical guidance in the literature generally treats ε≤1 as strong and single-digit ε as moderate. Composition across repeated releases (e.g. recomputing nightly) adds up. For openhealth, any community benchmark would need a **fixed, infrequent release cadence** with a lifetime budget, not live recomputation.
- The noise scale for a bounded mean is roughly (range)/(n·ε). With n≈5–50 and ε≈1, noise is comparable to the spread between people, so percentiles would carry little information.

### Gaps

- I found no authoritative regulator-endorsed numeric ε for health statistics. ε guidance remains a matter of convention and context.
- Google's DP library/RAPPOR parameters were not retrieved this session.

## Q7. GDPR status of aggregates of special-category data; consent

### Takeaway

Aggregates are anonymous only if no one can be singled out, linked or inferred by "means reasonably likely to be used". UK and EU regulators treat identifiability as a spectrum that depends on context. Crucially, the controller holding the source data usually still holds personal data. Contributing health data to a community benchmark is processing of special-category data and needs an Art. 9 condition (realistically explicit consent) at the point of contribution.

### Cited Findings

- ICO 2025 guidance (published March 2025): identifiability is "a spectrum… with a blurred band in between". Data can "move" along it. Use the "motivated intruder" test (a reasonably competent person with internet, libraries and public documents). The same information "may be personal data in your hands" yet anonymous for others, and you "must not retain any additional information within your organisation that would allow identification" if you claim anonymisation. — [ICO guidance page](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/how-do-we-ensure-anonymisation-is-effective/); [Taylor Wessing summary 2025](https://www.taylorwessing.com/en/global-data-hub/2025/spotlight-on-the-uk-data-landscape/gdh---new-ico-guidance-on-anonymisation-and-pseudonymisation)
- The ICO lists generalisation (e.g. age bands) and randomisation (noise) as the two main families of technique. Pseudonymised data remains personal data. — [Taylor Wessing](https://www.taylorwessing.com/en/global-data-hub/2025/spotlight-on-the-uk-data-landscape/gdh---new-ico-guidance-on-anonymisation-and-pseudonymisation); [SCL](https://www.scl.org/ico-publishes-anonymisation-guidance/)
- WP29 Opinion 05/2014 sets the singling-out / linkability / inference test and says anonymisation is itself processing of personal data. — [WP216](https://ec.europa.eu/justice/article-29/documentation/opinion-recommendation/files/2014/wp216_en.pdf)
- An EDPB/ICO comparison of anonymisation and pseudonymisation positions is available. — [Lexology](https://www.lexology.com/library/detail.aspx?g=98a51c2c-f655-4683-b065-b5c6ae8b6c21) (not fetched)

### Inferences

- Collecting per-user metrics into a shared pool is processing of health data (GDPR Art. 9). Opt-in should be explicit, granular (per metric), withdrawable, and separate from app terms. Withdrawal must remove the user's contribution from future releases.
- Published aggregates may count as anonymous only if they pass the motivated-intruder test against household members and other operators. In a tiny deployment, the household member _is_ a highly motivated intruder with rich auxiliary knowledge.

### Gaps

- I did not retrieve the EDPB's 2025 pseudonymisation guidelines (01/2025) or any newer EDPB anonymisation guidance text. The writer should not cite their contents without checking.
- I didn't verify whether the ICO 2025 guidance discusses aggregates and small numbers explicitly. The fetched section did not.

## Q8. Feasibility in a self-hosted single-household / small-org deployment

### Takeaway

Within a single household or small organisation, a "community" benchmark cannot be made safe or meaningful. Cohorts per age/sex band would be in single digits. Members know each other's ages and sexes. Any percentile release effectively discloses individuals' values, and DP noise at that scale destroys usefulness. Benchmarks for such deployments should come from external published reference data (another researcher's scope). Cross-instance pooling would need federated DP aggregation with a large total n and is a separate, high-effort project.

### Cited Findings

- Reconstruction and differencing risk grows as the population shrinks and the number of released statistics grows. — [Dinur–Nissim via Kamath notes](https://www.gautamkamath.com/CS860notes/lec2.pdf); [Census 2020](https://www2.census.gov/about/policies/2020-03-05-differential-privacy.pdf)
- People can be singled out within a family context from as little as year of birth. — [ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/how-do-we-ensure-anonymisation-is-effective/)
- Even k=5 (the NHS strong-anonymisation standard) exceeds the size of many household cohorts. — [ICO](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/data-sharing/anonymisation/how-do-we-ensure-anonymisation-is-effective/)

### Inferences

- Recommendation for openhealth: (1) no intra-instance community benchmark. (2) If cross-instance pooling is ever considered, use opt-in explicit consent; client-side or central DP with a fixed lifetime ε budget; release only in coarse bands on a fixed infrequent schedule; minimum-n suppression _in addition to_ DP; and no per-metric live recomputation. (3) Show comparisons against published reference ranges by default, with self-trend as the primary view.
- Even in a 100+ user small-org instance, the employer/admin is a motivated intruder (and there are HR/power-imbalance concerns). This strengthens the case against intra-org benchmarks.

### Gaps

- I found no published case study of federated DP health benchmarks across self-hosted open-source instances.
