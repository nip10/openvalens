# Nutrient targets and safety safeguards for a calorie/macro/micronutrient tracker (openhealth)

Scope: adults 18+, wellness (no diagnosis), users in US, UK, EU incl. Portugal. Research as of 2 Oct 2026.

Method note: the session's web-search budget ran out partway through, and several primary sources (NICE, NCBI Bookshelf, PubMed, EUR-Lex, the EU Commission's MDCG PDF, Springer) blocked or only partly rendered automated fetches. Every claim below has a source. Where I could only reach a secondary or aggregator source, the bullet says so. Values I know from background but could not verify in this session are listed under **Gaps** and marked "verify". They are not in Cited Findings.

---

## 1. Reference values (US/Canada DRIs, EFSA DRVs, UK SACN/COMA, Portugal), differences, and licensing

### Takeaway
WHO population goals for free sugars, saturated fat, trans fat, sodium and fibre were verified and work as a cross-jurisdiction "limit" layer. UK SACN is stricter on free sugars (5% vs WHO's 10%). EFSA website content may be reused with attribution, but EFSA reserves rights over individual documents and data, so a DRV table taken from EFSA needs a licence check before it goes into an open-source repo. I could not retrieve the NASEM DRI table text or its licence statement in this session.

### Cited Findings
- WHO healthy-diet fact sheet (adults): free sugars "less than 10% of total daily energy intake, which is equivalent to 50 g (or about 12 level teaspoons)", with further benefit at ≤5%. Saturated fat "no more than 10% of total energy intake". Trans fat "no more than 1%". Total fat "30% or less ... may help to prevent unhealthy weight gain". Salt "less than 5 grams per day (2 grams per day sodium)". Fibre "at least 25 grams of naturally-occurring dietary fibre". Fruit and vegetables "at least 400 grams" — [WHO Healthy diet fact sheet](https://www.who.int/news-room/fact-sheets/detail/healthy-diet)
- UK SACN *Carbohydrates and Health* (published 17 July 2015): "Free sugars should account for no more than 5% daily dietary energy intake", and sugar-sweetened beverage intake "should be minimised" — [GOV.UK SACN carbohydrates and health report](https://www.gov.uk/government/publications/sacn-carbohydrates-and-health-report)
- EFSA legal notice: "Copyright © for the entire content of this website unless otherwise stated: European Food Safety Authority – EFSA." "Re-use is authorised, provided that EFSA is acknowledged as the source of the material." The notice adds that individual documents may carry their own copyright conditions, and that reuse of "information, documents and data posted on EFSA's website or the OpenEFSA portal may be subject to protection under intellectual property rights" and data-exclusivity rules. The EFSA logo needs prior written permission. EFSA accepts no responsibility for downstream use — [EFSA Legal notice](https://www.efsa.europa.eu/en/legalnotice)
- EFSA's DRV Finder is described by EFSA as "primarily for nutrition professionals (e.g. dietitians or nutritionists), & public authorities" — [EFSA on X](https://twitter.com/EFSA_EU/status/1372558009369509890). It was launched in December 2018 and updated in 2019 with new nutrients, languages and features — [NutraIngredients](https://www.nutraingredients.com/Article/2018/12/04/EFSA-launch-interactive-Dietary-Reference-Value-tool-for-food-firms/); [EFSA on X](https://x.com/EFSA_EU/status/1167074715141378048)
- USDA FoodData Central has four data types. Foundation Foods are analytical sample data. SR Legacy had its final release in April 2018. FNDDS supports NHANES/WWEIA and is updated every 2 years. Branded Foods is "Data from labels of national and international branded foods collected by a public-private partnership", updated monthly — [FoodData Central documentation](https://fdc.nal.usda.gov/data-documentation/). The page did not show a licence statement in the fetched content.

### Inferences
- A practical default stack is one "limits" layer that is the same in every region (WHO: free sugars <10% E, sat fat <10% E, sodium <2 g), plus a region-selectable "adequacy" layer for micronutrient RDAs/PRIs (US = NASEM DRI; EU/PT = EFSA DRV; UK = COMA/SACN RNI). The UK free-sugars goal would be shown as 5% E.
- Show the source and value type next to each target (RDA/PRI = covers ~97.5% of people; AI = adequacy assumed, weaker evidence; UL = upper limit; AMDR/RI = range). This is honest, and it avoids implying that an AI is a deficiency threshold.
- Licensing: storing numbers (facts) with attribution is probably low-risk. Copying EFSA's or NASEM's formatted tables or text verbatim into an open-source repo should get a licence check. **Flag: legal review** for EFSA document-specific terms and NASEM copyright.

### Gaps
- **NASEM DRI values and licence not verified.** NCBI Bookshelf returned a CAPTCHA. Background values to verify: AMDR carbohydrate 45–65% E, fat 20–35% E, protein 10–35% E; protein RDA 0.8 g/kg/d; fibre AI 14 g/1,000 kcal (≈38 g men / 25 g women aged 19–50); sodium CDRR 2,300 mg/d (NASEM 2019). Also verify the licence. NASEM reports are typically © National Academy of Sciences, not US-government public domain, but HHS/USDA derivative tables and Dietary Guidelines for Americans may be public domain. **Flag: legal review.**
- **EFSA DRV values not verified** in this session. Background values to verify: protein PRI 0.83 g/kg/d; fibre AI 25 g/d; sodium 2.0 g/d "safe and adequate" (2019); carbohydrate RI 45–60% E; fat RI 20–35% E; EFSA 2022 sugars opinion said intake should be "as low as possible" with no UL set.
- **UK fibre goal (SACN 2015: 30 g/day AOAC) not verified.** The GOV.UK landing page did not show it.
- **Portugal:** I found no source confirming whether DGS (Direção-Geral da Saúde) or INSA publishes its own DRVs or defers to EFSA. Treat "Portugal = EFSA" as an assumption until checked.
- I found no reuse terms specific to the DRV Finder tool.

---

## 2. Protein: RDA vs. evidence for higher intakes, and honest presentation

### Takeaway
The best-supported target for adults doing resistance training is about 1.6 g/kg/d (Morton 2018 breakpoint), with a wide CI up to about 2.2 g/kg. ISSN suggests 1.4–2.0 g/kg/d for exercisers and more in an energy deficit. PROT-AGE suggests at least 1.0–1.2 g/kg/d for people over 65. All of these sources say kidney disease is a reason to limit protein. Show a range, label the population, and give the evidence type.

### Cited Findings
- Morton et al. 2018 (BJSM), meta-analysis and meta-regression of 49 RCTs (n=1,863) on protein supplementation during prolonged resistance training. Effects: fat-free mass +0.30 kg, 1RM strength +2.49 kg, fibre CSA +310 µm². Gains in fat-free mass plateaued at 1.62 g/kg/d (95% CI 1.03–2.20). The effect was smaller with older age and larger in trained than untrained participants — [Morton 2018 PDF](http://breathe-edu-downloads.s3.amazonaws.com/Morton-2018.pdf); summary via [ResearchGate record](https://www.researchgate.net/publication/318368028_A_systematic_review_meta-analysis_and_meta-regression_of_the_effect_of_protein_supplementation_on_resistance_training-induced_gains_in_muscle_mass_and_strength_in_healthy_adults)
- ISSN position stand (Jäger et al. 2017): "an overall daily protein intake in the range of 1.4–2.0 g protein/kg body weight/day ... is sufficient for most exercising individuals". "Higher protein intakes (2.3–3.1 g/kg/d) may be needed to maximize the retention of lean body mass in resistance-trained subjects during hypocaloric periods". Intakes >3.0 g/kg/d "may have positive effects on body composition in resistance-trained individuals". The fetched numbered points did not set safety thresholds — [ISSN 2017, PMC5477153](https://pmc.ncbi.nlm.nih.gov/articles/PMC5477153/)
- PROT-AGE (Bauer et al. 2013, JAMDA), for adults >65 years: "average daily intake at least in the range of 1.0 to 1.2 g protein per kilogram of body weight per day". "≥1.2 g/kg body weight/d" for those who are exercising and active. "1.2–1.5 g/kg body weight/d" for most with acute or chronic disease. "Older people with severe kidney disease (ie, estimated GFR <30 mL/min/1.73 m²), but who are not on dialysis, are an exception ... these individuals may need to limit protein intake" — [Europe PMC record, PMID 23867520](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:23867520%20AND%20SRC:MED&resultType=core&format=json)

### Inferences
- Suggested default display: "Population reference: 0.8 g/kg (RDA, prevents deficiency in ~all healthy adults)". Then a user-selectable band: "If you lift weights: ~1.6 g/kg (range 1.4–2.2; evidence: RCT meta-analysis)". Over 65: "≥1.0–1.2 g/kg (expert consensus)".
- ISSN is a sports-nutrition society position stand (expert opinion plus narrative review, and some authors have industry links). Morton is a meta-analysis of supplementation RCTs, mostly young men, with fat-free mass as a surrogate outcome. Label ISSN's 2.3–3.1 g/kg (lean body mass, deficit) as "athlete-specific, lower-certainty". Do not use it as a default.
- Calculate g/kg on a reference or adjusted body weight for users with high BMI. Otherwise targets become inflated. **Flag: clinical review** of which weight to use.
- If a user reports kidney disease, do not auto-raise protein targets (see section 6).

### Gaps
- I did not retrieve the RDA (0.8 g/kg) or EFSA PRI (0.83 g/kg) directly. Verify.
- I did not retrieve evidence on high-protein safety in healthy adults.

---

## 3. Fibre, sugar, saturated fat, sodium limits

### Takeaway
WHO gives verified universal limits: free sugars <10% E (≤5% conditional), sat fat ≤10% E, trans ≤1% E, sodium <2 g (salt <5 g), fibre ≥25 g. UK SACN sets free sugars at ≤5% E. The US label uses "added sugars", which is a different construct from WHO/UK "free sugars".

### Cited Findings
- WHO limits as quoted in section 1 — [WHO Healthy diet](https://www.who.int/news-room/fact-sheets/detail/healthy-diet)
- SACN free sugars ≤5% E — [GOV.UK SACN](https://www.gov.uk/government/publications/sacn-carbohydrates-and-health-report)
- The US Nutrition Facts label now requires Added Sugars, Vitamin D and Potassium, and still requires Calcium and Iron. Vitamins A and C are now voluntary. Daily Values were revised for sodium, dietary fibre, added sugars and vitamin D. Compliance: 1 Jan 2020 for manufacturers with ≥$10M sales, 1 Jan 2021 for smaller ones — [FDA Changes to the Nutrition Facts Label](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/changes-nutrition-facts-label)

### Inferences
- Free sugars cannot be calculated reliably from typical database fields. EU labels give "sugars" (total). US labels give total and added sugars. An app tracking "free sugars" will usually only have total sugars. Show "Sugars (total)" honestly, and only show a free/added-sugars limit when the field is actually present.
- Sodium vs salt: EU/UK labels declare salt, and the conventional conversion is salt = sodium × 2.5. Store sodium canonically and display per locale.

### Gaps
- The new US DV numbers (sodium 2,300 mg; fibre 28 g; added sugars 50 g) were not shown in the fetched FDA text. Verify.
- EFSA 2019 sodium (2 g/day) and EFSA 2022 sugars opinion were not fetched.

---

## 4. Micronutrient tracking: database completeness, false "deficiency" signals, and label nutrients

### Takeaway
Labels only require a small set of nutrients, so branded or label-derived database entries usually leave most micronutrients blank. In the EU the mandatory declaration covers energy and 6 nutrients. In the US the label also requires vitamin D, calcium, iron and potassium. Unless the app treats "missing" separately from "zero", it will understate micronutrient intake and produce false "deficiency" signals.

### Cited Findings
- EU Regulation 1169/2011: Article 30(1) sets a mandatory nutrition declaration. Article 30(2) allows voluntary additions: monounsaturates, polyunsaturates, polyols, starch, fibre, and vitamins/minerals. Under Annex XIII, vitamins and minerals may only be declared when present in a "significant amount" (generally 15% of the reference value per 100 g). Part B sets adult reference intakes for energy, fat, saturates, carbohydrate, sugars, protein and salt — [EUR-Lex 32011R1169](https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:32011R1169). The fetch tool only summarised the text and did not quote it. Exact wording is in Gaps.
- US label: vitamin D, calcium, iron and potassium are mandatory. Vitamins A and C are voluntary — [FDA](https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/changes-nutrition-facts-label)
- USDA FDC Branded Foods data come "from labels" — [FDC documentation](https://fdc.nal.usda.gov/data-documentation/)

### Inferences
- In the EU, fibre is voluntary on labels and is often absent. In both regions, vitamins and minerals on labels usually appear only when fortified or significant. For branded EU foods, expect only energy, fat, saturates, carbohydrate, sugars, protein and salt.
- Design requirements:
  - store `null` (unknown), not 0
  - compute a per-nutrient "coverage" figure (the share of logged energy or items with a known value)
  - suppress or grey out "below target" messages when coverage is under a threshold, e.g. <80% (product decision, not evidence-based)
  - never use the word "deficient", which implies diagnosis
  - prefer composition-database entries (FDC Foundation/SR Legacy/FNDDS; national tables such as Portugal's INSA PortFIR, UK CoFID) over label-only entries for micronutrients.
- Present RDA/PRI as "intake goal" and AI as "adequate intake (lower certainty)". Average intake over ≥7 days, because DRIs refer to usual intake.

### Gaps
- I found no peer-reviewed quantification of micronutrient missingness in consumer food databases (for example, % of MyFitnessPal or Open Food Facts entries with vitamin data). Search budget ran out. Suggest a direct analysis of an Open Food Facts dump.
- I did not obtain the verbatim Article 30(1) list or the RI values. Verify: energy, fat, saturates, carbohydrate, sugars, protein, salt; RIs 8,400 kJ/2,000 kcal, 70 g fat, 20 g saturates, 260 g carbohydrate, 90 g sugars, 50 g protein, 6 g salt.
- The licence and coverage of the Portuguese (INSA) and UK (CoFID) composition tables were not checked.

---

## 5. Goal modes: recomposition, safe deficits/surpluses, minimum intake floors

### Takeaway
Clinical guidelines for weight loss commonly use a deficit of about 500–600 kcal/day, aiming for roughly 0.5–1 kg (1–2 lb) per week. Prescribed weight-loss intakes in US guidelines start at 1,000–1,200 kcal (women) and 1,200–1,600 kcal (men) in NHLBI 1998, or 1,200–1,500 kcal (women) and 1,500–1,800 kcal (men) in AHA/ACC/TOS 2013. Diets under 800 kcal/day (VLCD) are a supervised clinical intervention. The often-quoted "NIH 1,200/1,500" floor was not found in that exact form.

### Cited Findings
- NHLBI 1998 Clinical Guidelines: "diets containing 1,000 to 1,200 kcal/day should be selected for most women, and a diet between 1,200 kcal/day and 1,600 should be chosen for men". "Reductions of 500 to 1,000 kcal/day will produce a recommended weight loss of 1 to 2 pounds per week" — [NHLBI ob_gdlns.pdf](https://www.nhlbi.nih.gov/files/docs/guidelines/ob_gdlns.pdf); [NHLBI Practical Guide](https://www.nhlbi.nih.gov/files/docs/guidelines/prctgd_c.pdf). These quotes come from search snippets of those documents.
- 2013 AHA/ACC/TOS guideline: prescribe "1200–1500 kcal/d for women and 1500–1800 kcal/d for men (kilocalorie levels are usually adjusted for the individual's body weight)", or an energy deficit of ≥500 kcal/d (or 30%) — [Jensen et al. 2013, PMC5819889](https://pmc.ncbi.nlm.nih.gov/articles/PMC5819889/)
- NICE NG246 (2025, overweight and obesity management): VLCDs (<800 kcal/day) only under clinical supervision within a structured programme; a deficit of ~600 kcal below energy needs for 0.5–1 kg/week. **Low-quality source:** NICE blocked the fetch, so this came from a commercial pharmacy blog summarising NG246 — [Bolt Pharmacy summary](https://www.boltpharmacy.co.uk/guide/is-1600-calories-a-deficit). The "600 kcal deficit" wording matches long-standing NICE (CG189) practice, but confirm against NG246 itself.
- NIH National Task Force on VLCDs (1993) is the origin of US VLCD supervision guidance — [PubMed 8345648](https://pubmed.ncbi.nlm.nih.gov/8345648/) (title only).

### Inferences
- Suggested goal modes and defaults (product proposal, **flag: clinical review**):
  - **Maintain:** estimated TDEE ± 0.
  - **Lose:** user chooses a rate of 0.25–1.0% of body weight per week. Default to about a 500 kcal/day deficit, capped so the target never goes below a floor.
  - **Gain:** small surplus (e.g. +250–500 kcal/day). I found no guideline source for surplus size, so label it as convention.
  - **Recomposition:** maintenance or a small deficit, a protein band of ~1.6–2.2 g/kg, and a resistance-training prerequisite. Use body composition and strength as the success metrics, not scale weight.
- Floor: do not auto-generate targets below about 1,200 kcal (women) or 1,500 kcal (men). These are the lower bounds of the AHA/ACC/TOS 2013 prescribed range, so they are conservative and defensible. Lower values should need a manual override with a "talk to a clinician" message, and values under 800 kcal should not be offered as a target at all. The 1,200/1,500 figures should be cited to AHA/ACC/TOS 2013, **not "NIH"**.
- Prefer a sex-neutral floor based on BMR (e.g. never below estimated BMR) as well as the fixed numbers. This is my inference and needs **clinical review**.

### Gaps
- **Recomposition evidence not retrieved** (e.g. Barakat et al. 2020, *Strength Cond J*). The search budget ran out. Evidence is mostly small trials in trained or overweight people. Verify before making claims.
- I found no authoritative source for a safe surplus size or weekly gain rate.
- NG246 text needs direct verification. It is unclear whether NG246 replaced CG189's dietary recommendations wholesale.
- I found no primary source for "NIH: <1,200 kcal women / <1,500 men only with supervision" in that phrasing. It may be a paraphrase of NIDDK consumer pages or of the AHA/ACC/TOS ranges.

---

## 6. Eating-disorder safeguards in calorie-tracking apps

### Takeaway
Tracker use is consistently *associated* with disordered eating in cross-sectional studies. It has a large self-reported role among people who already have an ED (73% of MFP users with an ED said it contributed). But the six experimental studies found no significant harm in short-term use, and causal direction is unknown. Safeguards are justified as a precaution for a vulnerable minority, not as proof that tracking causes EDs.

### Cited Findings
- Levinson, Fewell & Brosof 2017, *Eating Behaviors* 27:14–16. Sample: 105 people diagnosed with an ED. 73% of MyFitnessPal users endorsed that the app "partially contributed" to their ED, and this perception correlated with ED symptoms — [ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1471015317301484); [ResearchGate](https://www.researchgate.net/publication/319194941_My_Fitness_Pal_calorie_tracker_usage_in_the_eating_disorders)
- Moody et al. 2025, *European Eating Disorders Review* 33(6):1288–1313, systematic review of 27 studies (N=10,584), mostly female undergraduates:
  - Cross-sectional studies showed fairly consistent associations of tracker use with global disordered eating (7/8 studies), dietary restraint, and excessive exercise.
  - The 6 experimental or quasi-experimental studies "generally showed no significant impacts", but they were short-term and excluded high-risk people.
  - Authors' conclusion: "it is currently not possible to conclude if they increase disordered eating, or the direction of this relationship". Weight- or shape-motivated use showed stronger associations than health-motivated use.
  - [PMC12547374](https://pmc.ncbi.nlm.nih.gov/articles/PMC12547374/)
- As reported in Moody 2025: Simpson & Mazzeo 2017 found calorie-tracking (not fitness-tracking) use predicted dietary restraint, and fitness-tracking use correlated with disordered eating. Linardon & Messer 2019 found MyFitnessPal users had higher disordered-eating scores (d=0.91), dietary restraint (d=1.06), and shape/weight concerns (d up to 0.79) than non-users — [PMC12547374](https://pmc.ncbi.nlm.nih.gov/articles/PMC12547374/); [Simpson & Mazzeo 2017, ScienceDirect](https://www.sciencedirect.com/science/article/abs/pii/S1471015316303646)
- A qualitative study of diet/fitness app effects on ED behaviours exists in *BJPsych Open* — [Cambridge Core](https://www.cambridge.org/core/journals/bjpsych-open/article/effects-of-diet-and-fitness-apps-on-eating-disorder-behaviours-qualitative-study/2D1EE739D97AB3EFC6573835E4C527BD). I did not fetch its contents.

### Inferences
- Design safeguards suggested by these findings (product proposals, **flag: clinical/ED-specialist review**):
  1. A "numbers-free" or "hide calories" mode that still logs foods and patterns.
  2. No punitive or moralised copy ("cheat", "bad food", red "over budget" alarms). No streak-loss shaming.
  3. Hard floors on targets, with no gamified reward for exceeding a deficit.
  4. An onboarding question on ED history, with a gentle redirect away from calorie targets plus support resources (Beat UK, NEDA/ANAD helplines in the US, and an equivalent for Portugal).
  5. Detection heuristics: sustained intake below the floor, rapid weight loss, very frequent logging or weighing. These should trigger supportive check-ins, not targets.
  6. Ask about motivation (health vs. weight/shape), since weight/shape-motivated use is more strongly associated with harm.
- Never phrase app copy as "this app causes EDs" or "this app is safe". The evidence supports "may be harmful for some people".

### Gaps
- **ED charity guidance not retrieved** (Beat, NEDA, ANAD) on calorie apps. Search budget ran out. Helpline names and numbers must be verified before shipping. Note that NEDA closed its helpline in 2023. Verify current US resources (e.g. ANAD helpline, 988).
- I did not retrieve academic design guidelines (e.g. Eikey & Reddy, CHI 2017; Eikey et al. on "designing for recovery").
- I did not find validated short ED screeners suitable for in-app use, or their licensing (e.g. SCOFF, ESP).

---

## 7. Conditions and populations where calorie targets should not be auto-generated

### Takeaway
Only the kidney-disease protein caveat (PROT-AGE, eGFR <30) and the VLCD supervision rule were verified in this session. The other exclusions (pregnancy/lactation, minors, insulin/sulfonylurea users, bariatric surgery, ED history) are clinically reasonable but were not sourced here. Treat them as proposals that need clinical review.

### Cited Findings
- Severe kidney disease (eGFR <30, not on dialysis): may need to limit protein. This is an exception to higher-protein advice — [PROT-AGE, Europe PMC](https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=EXT_ID:23867520%20AND%20SRC:MED&resultType=core&format=json)
- VLCD (<800 kcal) needs a supervised clinical programme — [Bolt Pharmacy summary of NICE NG246](https://www.boltpharmacy.co.uk/guide/is-1600-calories-a-deficit) (secondary); [NIH Task Force VLCD 1993](https://pubmed.ncbi.nlm.nih.gov/8345648/)
- The FDA 2026 wellness guidance allows glucose-related wellness products for "monitoring nutritional impacts" only when "specifically contraindicated for use with diabetics and pre-diabetics". This shows the FDA itself expects diabetes to be carved out of wellness nutrition features — [Covington, Jan 2026](https://www.cov.com/en/news-and-insights/insights/2026/01/fda-issues-revised-guidance-on-general-wellness-products)

### Inferences
- Proposed gating (**clinical review required**). When the user selects any of these, the app turns off auto-generated deficit targets and protein increases. It still allows logging, optional clinician-entered targets, and a "discuss with your care team" message:
  - pregnancy or lactation
  - under 18 (already excluded by the app's scope)
  - diabetes treated with insulin or sulfonylureas (hypoglycaemia risk with energy or carbohydrate restriction)
  - CKD (protein)
  - current or past ED
  - bariatric surgery (specific protein and micronutrient protocols)
  - BMI <18.5
  - active cancer treatment or frailty
- Treat these as self-declared flags. They should not trigger any diagnosis or inference.

### Gaps
- No sources were retrieved for the pregnancy energy increments, bariatric protein targets, the insulin/sulfonylurea hypoglycaemia caveat, or how commercial apps (MyFitnessPal, Noom, Cronometer, MacroFactor) implement exclusions. All need verification.

---

## 8. Regulatory framing: is calorie/macro target setting a medical device (EU/US)? Claims to avoid

### Takeaway
In the US, software for "maintaining or encouraging a healthy lifestyle" that is unrelated to disease is excluded from the device definition by FD&C Act §520(o)(1)(B). The FDA's General Wellness guidance (revised January 2026) adds enforcement discretion for low-risk wellness products, provided they avoid references to specific diseases, conditions or diagnostic thresholds. I could not retrieve the EU text (MDR Art 2(1), MDCG 2019-11). The usual reading is that lifestyle/well-being apps are not medical devices unless they have a medical intended purpose. **Flag: regulatory/legal review in both jurisdictions.**

### Cited Findings
- FDA *General Wellness: Policy for Low Risk Devices*, current version issued January 2026 (6 Jan 2026), superseding the September 2019 version. It addresses "low risk products that promote a healthy lifestyle" and refers to FD&C Act §520(o)(1)(B): software "for maintaining or encouraging a healthy lifestyle and is unrelated to the diagnosis, cure, mitigation, prevention, or treatment of a disease or condition" — [FDA guidance page](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices); [Faegre Drinker](https://www.faegredrinker.com/en/insights/publications/2026/1/key-updates-in-fdas-2026-general-wellness-and-clinical-decision-support-software-guidance)
- The two intended-use categories are (1) maintaining or encouraging a healthy lifestyle, unrelated to disease, and (2) helping users "live well with certain chronic diseases or conditions through healthy lifestyle choices". A product loses wellness status if it includes "references to specific diseases, clinical conditions, or diagnostic thresholds", claims to substitute for an FDA-cleared device, prompts specific clinical action, or measures values "for medical purposes such as screening, diagnosis, monitoring, alerting or management" — [Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/fda-issues-revised-guidance-on-general-wellness-products)
- The 2026 version permits prompts to consult a health care professional when outputs fall outside normal ranges, as long as they make no disease-specific, diagnostic or treatment statements — [Troutman Pepper Locke](https://www.troutman.com/insights/fdas-2026-guidance-on-general-wellness-devices-policy-for-low-risk-devices/); [Honigman](https://www.honigman.com/alert-3236)

### Inferences
- Safe framing: "helps you track what you eat and set personal nutrition goals for general health and fitness". Avoid:
  - "treat/manage/prevent diabetes, obesity, hypertension, CKD"
  - "diagnose deficiency" or "you are deficient in X"
  - disease-specific targets such as "renal diet" or "diabetic carb target"
  - "clinically proven weight loss"
  - "replaces a dietitian"
- Obesity is a disease, so in the US a weight-*loss* claim tied to obesity may fall outside wellness category (1). The guidance's category (2) covers some weight-management claims, but this needs **legal review**.
- EU: under MDR 2017/745, intended purpose decides the classification. A generic nutrition tracker without a medical purpose is likely not a device. Features that calculate disease-specific therapy (e.g. insulin dosing from carbohydrates, CKD protein prescriptions) could make it medical device software. **Legal review**, plus a check against MDCG 2019-11 (rev. 2025).
- Separately, the EU Nutrition and Health Claims Regulation (1924/2006) governs claims on *foods*, not apps, but app copy about specific foods should not make unauthorised health claims. (Inference; not verified.)

### Gaps
- MDR Article 2(1) and MDCG 2019-11 text were not retrieved (the EU Commission PDF returned 403).
- UK MHRA guidance on standalone software and apps was not retrieved.
- I did not retrieve the 2026 FDA guidance's own examples relating to weight management, diet, or calorie tracking. The download link was not fetched.
- I did not confirm whether the "chronic conditions" category explicitly covers obesity or weight management claims in the 2026 text.
