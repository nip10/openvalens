# Nutrition safety parameters for OpenValens (adaptive TDEE + weekly calorie proposals)

Research date: 2026-10-02. Scope: general-wellness, non-medical tracker; app proposes weekly calorie targets that the user must accept. Every number below either has a verbatim quote from a source fetched in this pass, or is explicitly marked "NOT VERIFIED THIS PASS". Clinical-population guidance (written for clinicians treating people with overweight/obesity) is labelled [CLINICAL]; athlete/healthy-population evidence is labelled [ATHLETE/GENERAL].

Proposed final policy values (summary, all to go in versioned config):

| Parameter                                  | Proposed value                                                                                                                                                                               | Basis                                                |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Absolute calorie floor, female             | 1,200 kcal/d                                                                                                                                                                                 | AHA/ACC/TOS 2013 lower bound of the women's range    |
| Absolute calorie floor, male               | 1,500 kcal/d                                                                                                                                                                                 | AHA/ACC/TOS 2013 lower bound of the men's range      |
| Floor if sex not declared                  | 1,500 kcal/d (conservative)                                                                                                                                                                  | Inference: use the higher of the two                 |
| Effective floor                            | max(estimated RMR, sex floor)                                                                                                                                                                | Product decision; RMR part is inference, see Q1 gaps |
| Hard refusal threshold (never propose)     | <800 kcal/d is VLCD; 800–1,200 is "low-energy diet" needing specialist services under NICE                                                                                                   | NICE NG246 1.16.8–1.16.9; AHA 4e                     |
| Max deficit                                | min(500 kcal/d, 20% of estimated TDEE) default; never above 750 kcal/d or 25%                                                                                                                | AHA 500/750 kcal; Garthe ~19% vs 30%                 |
| Max projected loss rate                    | 0.7% bodyweight/week default, hard cap 1.0%/week                                                                                                                                             | Garthe 2011; Helms 2014                              |
| Max surplus for gain                       | +10–20% of TDEE, target gain 0.25–0.5% bodyweight/week                                                                                                                                       | Iraki 2019                                           |
| Max week-to-week change in proposed target | NO PRIMARY SOURCE; suggest ≤150–250 kcal/step (engineering choice)                                                                                                                           | Gap                                                  |
| BMI lower bound                            | No deficit proposal if current BMI <18.5 or projected end BMI <18.5                                                                                                                          | WHO underweight cutoff                               |
| Exclusions that disable deficit proposals  | <18, pregnant/breastfeeding, current/past ED, insulin/sulfonylurea/meglitinide use, CKD (for protein suggestions and deficit), age ≥65 (soft: require extra confirmation, protein ≥1.0 g/kg) | See Q4                                               |
| Default protein suggestion                 | 0.8 g/kg (RDA/PRI) baseline; 1.2–1.6 g/kg only if user opts into "active/resistance training"; suppressed/capped at 0.8 g/kg with CKD                                                        | See Q7                                               |

## 1. Fixed minimum calorie intake for unsupervised, app-proposed targets

### Takeaway

The best primary source for a sex-specific floor is the 2013 AHA/ACC/TOS guideline (Jensen et al.), which prescribes 1,200–1,500 kcal/d for women and 1,500–1,800 kcal/d for men in a clinical lifestyle program; NICE NG246 (2025) puts anything at 800–1,200 kcal/d ("low-energy diet") inside specialist services and <800 kcal/d (VLCD) only for clinically assessed need. Therefore an unsupervised app should never propose below 1,200 (women) / 1,500 (men or undeclared) kcal/d.

### Cited Findings

- [CLINICAL] AHA/ACC/TOS 2013, Recommendation 3a: "Prescribe 1200–1500 kcal/d for women and 1500–1800 kcal/d for men (kilocalorie levels are usually adjusted for the individual's body weight); Prescribe a 500-kcal/d or 750-kcal/d energy deficit; or Prescribe one of the evidence-based diets that restricts certain food types..." — [Jensen et al. 2013, Circulation, PMC full text](https://pmc.ncbi.nlm.nih.gov/articles/PMC5819889/)
- [CLINICAL] Same guideline, evidence statement: "usually 1200 to 1500 kcal/d for women and 1500 to 1800 kcal/d for men (kilocalorie levels are usually adjusted for the individual's body weight and physical activity levels); Estimation of individual energy requirements according to expert guidelines and prescription of an energy deficit of 500 kcal/d or 750 kcal/d or 30% energy deficit" — [Jensen et al. 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC5819889/)
- [CLINICAL] AHA/ACC/TOS Recommendation 4e: "Use a very-low-calorie diet (defined as <800 kcal/d) only in limited circumstances and only when provided by trained practitioners in a medical care setting where medical monitoring and high-intensity lifestyle intervention can be provided. Medical supervision is required because of the rapid rate of weight loss and potential for health complications." — [Jensen et al. 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC5819889/)
- [CLINICAL] NICE NG246 (2025) 1.16.8: "Consider low-energy diets (800 to 1,200 kilocalories per day, also known as low-calorie diets) only as part of a multicomponent overweight and obesity management strategy with long-term support within a specialist overweight and obesity management service (or other services for the management of long-term conditions such as type 2 diabetes)..." — [NICE NG246, Physical activity and diet](https://www.nice.org.uk/guidance/ng246/chapter/Physical-activity-and-diet)
- [CLINICAL] NICE NG246 1.16.9: "Consider very-low-energy diets (under 800 kilocalories per day, also known as very-low-calorie diets) only as part of a multicomponent strategy within a specialist overweight and obesity management service, for people who: are living with obesity and have a clinically assessed need to lose weight rapidly (for example, to make surgery safer and more feasible). [2025]" — [NICE NG246](https://www.nice.org.uk/guidance/ng246/chapter/Physical-activity-and-diet)
- NICE NG246 1.16.10: "Do not use low-energy diets or very-low-energy diets as a long-term strategy to manage obesity." 1.16.11: ensure they "are nutritionally complete, last no more than 12 weeks, include ongoing clinical support and supervision..." — [NICE NG246](https://www.nice.org.uk/guidance/ng246/chapter/Physical-activity-and-diet)
- Primary vs secondary: the 2013 AHA/ACC/TOS guideline is the primary source for the 1,200–1,500 / 1,500–1,800 ranges (it was developed with NHLBI and supersedes the 1998 NHLBI Clinical Guidelines). NICE NG246 replaced CG189 and is the current UK primary source. — [Jensen et al. 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC5819889/); [NICE NG246](https://www.nice.org.uk/guidance/ng246/chapter/Physical-activity-and-diet)

### Inferences

- Note the tension: NICE classes 800–1,200 kcal/d as a "low-energy diet" for specialist services, while AHA's women's range starts at 1,200. Setting the female floor at exactly 1,200 kcal/d sits at the boundary of both, so it is the lowest value you can defend. A more conservative option is 1,300–1,400 for women, but no guideline gives that number.
- Users who don't declare sex: use 1,500 kcal/d (the male floor). That way an unknown user never gets a target below what either guideline would allow for men, and the rule is simple to explain. An alternative is 1,200, but it is less conservative for larger bodies.
- Use max(estimated RMR, sex floor). The guideline ranges are "adjusted for the individual's body weight", so a large or tall person can have an RMR above 1,500, and a fixed floor alone would let their deficit go deeper than intended. Using RMR as a floor is a conservative product choice. No guideline says "never eat below RMR".
- These numbers come from clinical obesity programs with professional contact. In an unsupervised app they work as ceilings on aggressiveness, not as targets. The UI should never present the floor as a goal (see the Beat "numbers become targets" finding in Q5).

### Gaps

- NHLBI 1998 Clinical Guidelines / Practical Guide (NIH Pub. 00-4084): the PDF at https://www.nhlbi.nih.gov/files/docs/guidelines/prctgd_c.pdf was retrieved but could not be text-extracted in this environment. From memory it gives 1,000–1,200 kcal/d for women and 1,200–1,600 kcal/d for men, a 500–1,000 kcal/d deficit, and 1–2 lb/week. NOT VERIFIED THIS PASS; do not cite it without checking. The 2013 guideline is the newer primary source in any case.
- EASO VLCD statements were not fetched.
- I found no peer-reviewed primary evidence that a sustained intake below measured RMR is itself harmful in healthy adults. The RMR floor rests on a precautionary principle, not on evidence. Residual risk: equations such as Mifflin-St Jeor carry about ±10% individual error, so "RMR" is itself an estimate.

## 2. Maximum rate of weight loss, deficit size, step change, surplus

### Takeaway

Cap proposals so that projected loss is ≤0.7% of bodyweight/week by default (hard cap 1.0%/week), with a deficit of no more than 500 kcal/d or 20% of TDEE, whichever is smaller (absolute ceiling 750 kcal/d or 25%). For gain, use a surplus of +10–20% of TDEE targeting 0.25–0.5% of bodyweight/week. No primary source gives a "max week-to-week target change"; that is an engineering parameter.

### Cited Findings

- [CLINICAL] Deficit size: "Prescribe a 500-kcal/d or 750-kcal/d energy deficit", and the evidence statement mentions "or 30% energy deficit". — [Jensen et al. 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC5819889/)
- [CLINICAL] Expected magnitude: comprehensive lifestyle interventions "produce average weight losses of up to 8 kg in 6 months... Such losses (which can approximate reductions of 5% to 10% of initial weight)". — [Jensen et al. 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC5819889/)
- [ATHLETE] Garthe et al. 2011 RCT (n=24 elite athletes): "When weight loss (WL) is necessary, athletes are advised to accomplish it gradually, at a rate of 0.5-1 kg/wk." Arms were "0.7% slow reduction (SR) vs. 1.4% fast reduction (FR)"; "Energy intake was reduced by 19% ± 2% and 30% ± 4% in SR and FR"; "LBM increased in SR by 2.1% ± 0.4% (p < .001), whereas it was unchanged in FR"; the conclusion recommends "a weekly BW loss of 0.7%." — [Garthe et al. 2011, IJSNEM, PMID 21558571](https://pubmed.ncbi.nlm.nih.gov/21558571/)
- [ATHLETE] Helms et al. 2014: "Caloric intake should be set at a level that results in bodyweight losses of approximately 0.5 to 1%/wk to maximize muscle retention." The paper also warns that "competitors should be aware of the increased risk of developing eating and body image disorders in aesthetic sport". — [Helms, Aragon, Fitschen 2014, JISSN, PMID 24864135](https://pubmed.ncbi.nlm.nih.gov/24864135/)
- [GENERAL] ACSM 2009 Position Stand (Donnelly et al.) covers physical activity, not rate caps. It notes that NHLBI "encourage[s] a 10% reduction in weight, although considerable literature indicates reduction in health risk with 3% to 5% reduction in weight", and that "Moderate-intensity PA between 150 and 250 min wk(-1) will improve weight loss in studies that use moderate diet restriction but not severe diet restriction." — [Donnelly et al. 2009, MSSE, PMID 19127177](https://pubmed.ncbi.nlm.nih.gov/19127177/)
- [ATHLETE] Gain, from Iraki et al. 2019: "A hyper-energetic diet (~10–20%) should be consumed with a target weight gain of ~0.25–0.5% of bodyweight/week for novice/intermediate bodybuilders. Advanced bodybuilders should be more conservative with the caloric surplus and weekly weight gain." The paper also says "it may be more appropriate to look at average weekly weight changes based on daily (or multiple times per week) weigh ins to limit the errors of daily fluctuations". — [Iraki et al. 2019, Sports (Basel), PMC6680710](https://pmc.ncbi.nlm.nih.gov/articles/PMC6680710/)

### Inferences

- The 0.7%/week default and 1.0%/week cap come from athlete trials with supervised resistance training, which is an optimistic population. For general users, 0.5–0.7%/week is the more defensible default. At 80 kg, 0.7% is 0.56 kg/week, which matches the clinical "500 kcal/d" deficit (about 0.45–0.5 kg/week).
- Garthe's slow arm used about a 19% intake reduction, and the fast arm used 30%, which lost lean mass. That supports capping the deficit at about 20% of TDEE by default and never going past 25%. The 30% figure in AHA applies to clinician-supervised programs.
- Rule: proposed = max(floor, TDEE − min(500, 0.20·TDEE, deficit implied by 0.7%BW/wk)), using about 7,700 kcal/kg as the conversion (standard approximation, not sourced in this pass).
- Weekly step change: no guideline found. Iraki's advice on weekly averaging supports smoothing the TDEE input. Suggest limiting each accepted change to ≤200 kcal or ≤10% of the current target, so the system can't swing quickly on noisy estimates. Label it an engineering parameter.
- Gain proposals have no ED or BMI floor problem, but they should still respect the exclusions where a surplus may be clinically inappropriate (none found that require blocking gain, except that CKD affects protein, not energy).

### Gaps

- No primary source for "max step change per week" in adaptive targets.
- Garthe and Helms concern athletes; no RCT on rate caps in unsupervised general-population app users was found.
- Kcal-per-kg-of-weight-loss conversion and dynamic models (e.g., Hall's NIH model) were not fetched.

## 3. Lower body-weight bound (BMI)

### Takeaway

Use WHO's BMI <18.5 underweight cutoff: refuse deficit proposals when current BMI is <18.5 or when the projected end-of-plan BMI would fall below 18.5. I found no guideline-grade source for 20 as a cutoff. A stricter 20 can be chosen as a precautionary buffer but should be labelled a product choice.

### Cited Findings

- WHO Global Health Observatory defines adult underweight as "BMI < 18.5", overweight as "BMI >= 25", and obesity as "BMI >= 30". — [WHO GHO, Body mass index](https://www.who.int/data/gho/data/themes/topics/topic-details/GHO/body-mass-index)
- AHA/ACC/TOS and NICE target diet prescriptions at people "who would benefit from weight loss" or those "living with overweight/obesity". — [Jensen et al. 2013](https://pmc.ncbi.nlm.nih.gov/articles/PMC5819889/); [NICE NG246](https://www.nice.org.uk/guidance/ng246/chapter/Physical-activity-and-diet)

### Inferences

- An option that matches the guidelines more closely: only propose a deficit automatically when BMI ≥25 (the population the guidelines address). For BMI 18.5–24.9, allow deficits only on explicit user request, with a smaller cap (for example 0.5%/week). This is a judgement call; the guidelines simply don't address deficit prescription at healthy BMI.
- BMI is invalid for <18-year-olds (already excluded) and less accurate in very muscular people and older adults.
- Hide-numbers mode should still enforce the BMI gate silently. The refusal message must not state the BMI value or the threshold (see Q5).

### Gaps

- No primary source found supporting 20 over 18.5 for adults. Some Asian-population cutoffs differ for overweight, not underweight; not researched.

## 4. Self-declared exclusions that disable automated deficits

### Takeaway

Disable automated deficit proposals (logging stays) for: under 18; pregnant or breastfeeding; current or past eating disorder; use of insulin, sulfonylureas or meglitinides; CKD (also cap protein suggestions). Treat age ≥65 as a soft gate: allow it with an extra confirmation, a smaller cap, and a protein floor of ≥1.0 g/kg. Direct quotes were obtained for AAP (secondary summary), KDIGO, PROT-AGE and ADA (via search snippet); the pregnancy guidance is nuanced.

### Cited Findings

- Under 18: AAP 2016 clinical report "Preventing Obesity and Eating Disorders in Adolescents" (Golden et al., Pediatrics 138(3):e20161649) recommends that clinicians "discourage dieting, skipping of meals, or the use of diet pills", and it identifies dieting ("caloric restriction with the goal of weight loss") as a risk factor for both obesity and eating disorders. The quotes come via search summary and secondary coverage; the primary page was not fetched. — [AAP Pediatrics](https://publications.aap.org/pediatrics/article/138/3/e20161649/52684/Preventing-Obesity-and-Eating-Disorders-in); [Stanford Medicine summary](https://med.stanford.edu/news/all-news/2016/08/new-guidelines-offer-one-approach-to-prevent-teen-obesity-eating-disorders.html)
- Pregnancy: the IOM/ACOG framework recommends positive gestational weight gain in every BMI class (5–9.1 kg for obesity). ACOG Committee Opinion 548 notes, however, that for women with obesity who gain less than recommended with an appropriately growing fetus there is "no evidence" that encouraging more gain improves outcomes. Pregnancy is a clinically supervised situation in either case. — [ACOG CO 548](https://www.acog.org/clinical/clinical-guidance/committee-opinion/articles/2013/01/weight-gain-during-pregnancy); [PubMed 23262962](https://pubmed.ncbi.nlm.nih.gov/23262962/)
- Diabetes medications (ADA Standards of Care 2026): "Deintensify hypoglycemia-causing medications (insulin, sulfonylureas, or meglitinides)... for individuals who are at high risk for hypoglycemia", and "When adding a GLP-1 RA... sulfonylureas should be discontinued or the dose reduced and insulin dosing should be adjusted to avoid hypoglycemia." These come via search snippet; diabetesjournals.org returned 403. — [ADA SoC 2026 Section 9](https://diabetesjournals.org/care/article/49/Supplement_1/S183/163934/9-Pharmacologic-Approaches-to-Glycemic-Treatment); [Section 8](https://diabetesjournals.org/care/article/49/Supplement_1/S166/163915/8-Obesity-and-Weight-Management-for-the-Prevention)
- CKD, KDIGO 2024 Rec 3.3.1.1: "We suggest maintaining a protein intake of 0.8 g/kg body weight/d in adults with CKD G3–G5 (2C)." Practice Point 3.3.1.1: avoid high protein intake (>1.3 g/kg/d) in adults with CKD at risk of progression. These come via search snippet of the guideline. — [KDIGO 2024 CKD Guideline PDF](https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf)
- Age ≥65, PROT-AGE: "To help older people (>65 years) maintain and regain lean body mass and function, the PROT-AGE study group recommends average daily intake at least in the range of 1.0 to 1.2 g protein per kilogram of body weight per day... Most older adults who have acute or chronic diseases need even more dietary protein (ie, 1.2-1.5 g/kg body weight/d). Older people with severe kidney disease (ie, estimated GFR <30 mL/min/1.73 m(2)), but who are not on dialysis, are an exception to this rule; these individuals may need to limit protein intake." — [Bauer et al. 2013, JAMDA, PMID 23867520](https://pubmed.ncbi.nlm.nih.gov/23867520/)
- Eating disorders: dieting is "the most important predictor" of developing an ED (AAP 2016 via summary). Calorie-tracker use is associated with "higher levels of eating concern and dietary restraint, controlling for BMI", and "for some individuals, these devices might do more harm than good". — [Simpson & Mazzeo 2017, Eat Behav, PMID 28214452](https://pubmed.ncbi.nlm.nih.gov/28214452/); [AAP Pediatrics](https://publications.aap.org/pediatrics/article/138/3/e20161649/52684/Preventing-Obesity-and-Eating-Disorders-in)
- Aesthetic-sport ED risk is explicitly flagged in Helms 2014 (see Q2). — [PMID 24864135](https://pubmed.ncbi.nlm.nih.gov/24864135/)

### Inferences

- Add GLP-1 RA / GIP-GLP-1 RA users (semaglutide, tirzepatide) as a soft flag rather than a hard exclusion. These drugs already suppress appetite, and stacking an app deficit on top risks inadequate intake. The evidence is indirect.
- Breastfeeding: no source fetched this pass. Exclude on a precautionary basis.
- For the ≥65 soft gate: PROT-AGE supports a protein floor of 1.0–1.2 g/kg, and sarcopenia risk supports the smaller rate cap (e.g., 0.5%/week). This is inference, not quoted guideline text.

### Gaps

- ADA 2026 Section 8 text on hypoglycemia during lifestyle calorie restriction could not be fetched (403). The quotes above are about medication deintensification in general. Verify Section 8 directly.
- ACOG/IOM breastfeeding energy guidance not fetched.
- ESPEN sarcopenia/geriatric guideline not fetched.
- Other candidate exclusions, not researched: type 1 diabetes, active cancer treatment, recent bariatric surgery, history of refeeding syndrome, gout. Mark as unknown.

## 5. Eating-disorder safety copy and resources

### Takeaway

The most concrete and actionable rule comes from Beat's media guidelines (updated Nov 2025): avoid specific weights, BMI, measurements and calorie counts, because those numbers become targets. When someone self-declares an ED, the app should drop numeric targets and deficit features without being asked, use neutral person-first language, and show verified helplines. The helplines below were checked on each organisation's own site where it was reachable.

### Cited Findings

- Beat media guidelines (PDF metadata: created 18 Nov 2025) list as things to avoid "Mentioning specific weights, BMI or measurements" and "Listing specific amounts eaten or calories consumed". They also tell writers to "List where readers can get help". Language advice: avoid using diagnoses as nouns or adjectives (e.g., "an anorexic student"), avoid implying an ED is a lifestyle choice, and avoid "-orexia" suffixes. — [Beat Media Guidelines PDF](https://beat.contentfiles.net/media/documents/Beat_Media_Guidelines.pdf); [Beat media guidelines page](https://www.beateatingdisorders.org.uk/media-centre/media-guidelines/)
- Beat's rationale (quoted in coverage of the guidelines): "The competitive nature of eating disordered thinking would mean such a number would become a target to aim for." — [Journo Resources](https://www.journoresources.org.uk/how-journalists-report-eating-disorders-media-guidelines/) (secondary)
- Evidence on tracker harm: in a qualitative analysis of 1,695 ED-forum comments about MyFitnessPal, the themes included "Preventing misuse, describing ways in which MyFitnessPal attempts to prevent pathological use and actions taken by users to circumvent its interventions". — [McCaig et al. 2020, IJED, PMID 31762064](https://pubmed.ncbi.nlm.nih.gov/31762064/). Associational data: [Simpson & Mazzeo 2017](https://pubmed.ncbi.nlm.nih.gov/28214452/)
- UK, Beat helplines (fetched 2026-10-02): "Our Helplines are open 3pm-8pm, Monday to Friday. England 0808 801 0677 Scotland 0808 801 0432 Wales 0808 801 0433 Northern Ireland 0808 801 0434". The page also lists Samaritans 116 123 and NHS 111/999 for medical help. — [Beat helplines](https://www.beateatingdisorders.org.uk/support-services/helplines/)
- US, NEDA: NEDA shut down its human-staffed helpline effective 1 June 2023, and its replacement chatbot "Tessa" was taken offline after giving harmful advice. — [CNN 2023](https://www.cnn.com/2023/06/01/tech/eating-disorder-chatbot); [The Register 2023](https://www.theregister.com/software/2023/05/31/eating-disorder-non-profit-neda-pulls-chatbot-for-bad-advice/603317). The NEDA site returned 403 in this pass, so its current self-description was not verified.
- US, National Alliance for Eating Disorders (took over the former NEDA number): "Call (866) 662-1235, Monday through Friday, 9:00 am to 7:00 pm EST". The former NEDA number 800-931-2237 "will automatically re-direct to The Alliance's helpline at 866-662-1235". The line is "run by licensed, eating disorder-specialized therapists". — [Alliance helpline page](https://www.allianceforeatingdisorders.com/helpline-acquisition/)
- US, ANAD helpline: "1-888-375-7767", "Monday through Friday from 9:00 AM to 9:00 PM CT". It is not described as a 24/7 crisis line. — [ANAD helpline](https://www.anad.org/eating-disorder-helpline/)
- Portugal, SNS 24: the psychological counselling service is reached at 808 24 24 24, option 4. It runs 24/7, is staffed by clinical psychologists, offers support in Portuguese and English, and calls are not recorded. This comes via search snippet of the SNS 24 page, which did not render on direct fetch. — [SNS 24 Aconselhamento psicológico](https://www.sns24.gov.pt/servico/aconselhamento-psicologico-no-sns-24/)
- International: findahelpline.com describes itself as offering "Free, confidential support from a helpline or hotline near you. Online chat, text or phone." — [Find A Helpline](https://findahelpline.com/)

### Inferences

- Recommended copy when a user self-declares a current or past ED (neutral, no numbers, no praise or blame): "Thanks for telling us. We've turned off calorie targets and weight-change suggestions. You can still log anything you like, or nothing at all, and you can change this in Settings. If things feel hard right now, talking to someone can help:" followed by the localised helplines. Do not ask for details, diagnosis or severity. Make the exclusion sticky: turning it off later should require a deliberate action and should not prompt the user to re-enable it.
- Wording rules: (1) Never show a calorie floor, BMI or target weight in refusal or ED copy. (2) No moral language ("good/bad food", "cheat", "earned", "guilt-free"). (3) No streaks, badges or celebrations tied to deficits or weight loss. Streak mechanics, if used, should attach to logging consistency only and be disabled under the ED exclusion. (4) Person-first language. (5) Every ED-related screen carries help signposting. (6) Refusals explain what the app won't do, not what the user's body is ("We don't suggest reductions for this profile").
- Localisation: PT → SNS 24 (808 24 24 24, option 4) plus findahelpline; US → Alliance (866-662-1235), ANAD (1-888-375-7767), 988 for crisis (NOT VERIFIED THIS PASS on 988lifeline.org); UK → Beat numbers above; elsewhere → findahelpline.com. Keep the numbers in versioned config with a `verified_at` date and re-check every 6–12 months, since hours have already changed (NEDA closed; Beat hours are 3–8pm).

### Gaps

- No Portuguese eating-disorder association helpline was verified on its own site. A "Núcleo de Doenças do Comportamento Alimentar" (217 972 110) appeared only in a 2022 hospital PDF list ([HVFX list](https://www.hospitalvilafrancadexira.pt/storage/texts/Lista%20associa%C3%A7%C3%B5es%20HVFX%202022.pdf)). Do not ship it without verification.
- Mindframe/NEDC (Australia) guidelines PDF ([Mindframe 2021](https://butterfly.org.au/wp-content/uploads/2021/09/Mindframe-Media-Guidelines_Eating-Disorders_2021.pdf)) could not be text-extracted, and the NEDC URL 404'd. AED guidance was not fetched.
- 988 (US Suicide & Crisis Lifeline) not verified on its own site this pass.
- No 2024–2026 peer-reviewed design guideline specifically for "safe calorie tracker design" was found in this pass; the evidence base is associational (Simpson & Mazzeo) and qualitative (McCaig).

## 6. Nutrient reference values: sources and redistribution

### Takeaway

EFSA DRVs may be reused with attribution ("Re-use is authorised, provided that EFSA is acknowledged as the source"), so they are safe to bundle for EU defaults. NIH ODS content is generally US-government public domain (attribution requested). NASEM DRI publications are © National Academy of Sciences, "All Rights Reserved", so store only the numeric values with a citation and do not copy tables or text verbatim. Treat bundling of NASEM values as residual legal risk.

### Cited Findings

- EFSA copyright notice: "Copyright © for the entire content of this website unless otherwise stated: European Food Safety Authority – EFSA. Re-use is authorised, provided that EFSA is acknowledged as the source of the material. For individual documents, the general principle of re-use outlined above may be subject to specific conditions as indicated in individual copyright notices contained therein." — [EFSA Legal notice](https://www.efsa.europa.eu/en/legalnotice)
- EFSA caveat: content on "websites linked to EFSA may be subject to protection under intellectual property rights... without obtaining the prior permission from the right(s)holders(s)". Applies to third-party material. — [EFSA Legal notice](https://www.efsa.europa.eu/en/legalnotice)
- The EFSA DRV Finder brings together values from EFSA's DRV opinions by nutrient and population group. — [NutraIngredients 2018](https://www.nutraingredients.com/Article/2018/12/04/EFSA-launch-interactive-Dietary-Reference-Value-tool-for-food-firms/); [EFSA DRV summary report 2017](https://www.efsa.europa.eu/sites/default/files/2017_09_DRVs_summary_report.pdf)
- NIH: "Most of the information on the NIH site is in the public domain and can be used without charge or restriction", with exceptions for third-party-licensed material; acknowledgement is requested as a courtesy. — [NIH FAQ](https://www.nih.gov/about-nih/frequently-asked-questions)
- NASEM DRI essential guide page: "© 2026 National Academy of Sciences. All Rights Reserved." — [NAP catalog 11537](https://nap.nationalacademies.org/catalog/11537/dietary-reference-intakes-the-essential-guide-to-nutrient-requirements)

### Inferences

- Region defaults: EU/EEA and UK users → EFSA; US users → NASEM DRIs (RDA/AI/UL/EAR). Store the numbers with citations to NASEM reports and link to NIH ODS fact sheets. A bare numeric fact is generally not copyrightable in the US (Feist), but the compiled table layout and text are, so keep only per-nutrient values in your own schema. Not legal advice; residual risk.
- WHO/FAO values: use them as a fallback for other regions (not researched in detail).
- Storage schema: `nutrient_code`, `value`, `unit`, `reference_type` (EFSA: AR, PRI, AI, RI, UL, SafeLevel; NASEM: EAR, RDA, AI, UL, AMDR, CDRR), `population_group` (sex, age_min, age_max, life_stage: pregnancy/lactation), `basis` (per day / per kg bw / % energy), `source_org`, `source_document` (DOI/URL), `source_version_or_year`, `retrieved_at`, `region_default`, `licence_note`. Keep EFSA "AR/PRI" and NASEM "EAR/RDA" as distinct enums, because they are not semantically identical.

### Gaps

- The EFSA DRV Finder page (multimedia.efsa.europa.eu/drvs) returned empty to curl. Whether it offers a bulk download, and whether that file carries extra licence terms, was not checked.
- The ODS-specific policy page did not load; the NIH-wide statement was used instead.
- NASEM terms of use for numerical reuse were not read in full.

## 7. Protein default suggestion

### Takeaway

A default of 0.8 g/kg/d (US RDA; EFSA PRI ≈0.83 g/kg) is safe as a baseline for healthy adults. Offer 1.2–1.6 g/kg only to users who opt in as active or resistance-training (ISSN gives 1.4–2.0 g/kg for exercisers), and ≥1.0–1.2 g/kg for age ≥65 (PROT-AGE). With self-declared CKD, suppress higher suggestions and cap at 0.8 g/kg with a "talk to your care team" note, per KDIGO.

### Cited Findings

- ISSN Position Stand: "an overall daily protein intake in the range of 1.4-2.0 g protein/kg body weight/day (g/kg/d) is sufficient for most exercising individuals"; "Higher protein intakes (2.3-3.1 g/kg/d) may be needed to maximize the retention of lean body mass in resistance-trained subjects during hypocaloric periods." — [Jäger et al. 2017, JISSN, PMID 28642676](https://pubmed.ncbi.nlm.nih.gov/28642676/)
- Iraki 2019 (bulking): "Sufficient protein (1.6–2.2 g/kg/day)". — [PMC6680710](https://pmc.ncbi.nlm.nih.gov/articles/PMC6680710/)
- PROT-AGE (>65 y): 1.0–1.2 g/kg/d; ≥1.2 if active; 1.2–1.5 with acute or chronic disease; exception for eGFR <30 not on dialysis. — [Bauer et al. 2013](https://pubmed.ncbi.nlm.nih.gov/23867520/)
- KDIGO 2024: "We suggest maintaining a protein intake of 0.8 g/kg body weight/d in adults with CKD G3–G5 (2C)", and avoid >1.3 g/kg/d in CKD at risk of progression. — [KDIGO 2024 CKD Guideline](https://kdigo.org/wp-content/uploads/2024/03/KDIGO-2024-CKD-Guideline.pdf)

### Inferences

- Do not default anyone to athlete ranges (2.3–3.1 g/kg). Those come from bodybuilding contest prep and could conflict with undiagnosed CKD.
- Because CKD is often undiagnosed, phrase higher suggestions as ranges with a caveat. Never show them under the CKD exclusion.

### Gaps

- US RDA 0.8 g/kg (NASEM 2002/2005 Macronutrients report) and EFSA PRI 0.83 g/kg (EFSA NDA Panel 2012, EFSA Journal 10(2):2557) are well established but were NOT VERIFIED THIS PASS. The EFSA journal page did not render. Verify quotes before citing.
- No direct quotes were obtained for "1.2–1.6 g/kg for active adults" as a single guideline range. The ISSN figure is 1.4–2.0, and the 1.2–1.6 band is an interpolation that stays conservative.
