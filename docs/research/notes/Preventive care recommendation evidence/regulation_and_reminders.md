# Preventive-care reminders in a consumer app: regulation, effectiveness, shared decision-making, safety governance, and data handling

Scope: OpenValens (open-source, self-hostable wellness app for adults 18+, used in the US, UK and EU including Portugal). Current as of 2 Oct 2026. Out of scope: which screenings are recommended, and supplements.

Legend: **[TEXT]** means quoted or closely paraphrased from regulation, statute or guidance text. **[INTERP]** means interpretation by a law firm, a commentator or this researcher. Items marked "(not re-fetched this session)" are well-established primary texts that I cited from known content without re-opening them during this session. Verify them before relying on them.

---

## 1. Regulation: what can ship without becoming a regulated medical device?

### Takeaway

- **US:** an app that uses age, sex and behavioural risk factors to show a lay user screening and preventive recommendations from "well-known and established authorities" (for example USPSTF or CDC) is a device function, but it falls on FDA's published **enforcement-discretion** list. It is not formally "non-device". Patient-facing tools cannot use the Cures Act §3060 non-device CDS exemption, because that exemption covers only HCP-facing software. The January 2026 CDS revision did not change this.
- **EU:** MDCG 2019-11 rev.1 (June 2025) names "an app that provides a 10-year risk of cardiovascular disease from data input by a lay user" as medical device software (MDSW). It also says generic pathways that are not directed to individual patients, and wellness apps, are not MDSW. So personalised risk calculation, or lab-value-triggered recommendations, very likely makes the app MDSW (class IIa by default under Rule 11a). Plain display of published guideline text keyed only to age and sex sits in a grey zone that depends on how the intended purpose is worded.
- Open-source, self-hosted distribution does not remove device status in the US. In the EU and UK it may matter, because "making available on the market" requires a commercial activity. That point needs legal advice.

### Cited findings

**US: statute and FDA guidance**

- **[TEXT]** Cures Act §3060 added FD&C Act §520(o)(1)(E). Non-device CDS must meet all four criteria: (1) it does not acquire, process or analyse a medical image or IVD signal; (2) it displays, analyses or prints medical information; (3) it is "intended for the purpose of supporting or providing recommendations to a **health care professional** about prevention, diagnosis, or treatment"; (4) it enables the HCP to "independently review the basis for the recommendations" — [Covington, Jan 2026](https://www.cov.com/en/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance)
- FDA revised the final CDS guidance on **6 Jan 2026**, superseding the 2022 version — [Cooley](https://www.cooley.com/news/insight/2026/2026-01-20-automation-bias-and-clinical-practice-fda-makes-incremental-updates-to-clinical-decision-support-software-guidance); [King & Spalding](https://www.kslaw.com/news-and-insights/fda-updates-general-wellness-and-clinical-decision-support-guidance-documents)
- **[INTERP]** Main changes in the 2026 CDS guidance:
  - FDA will use enforcement discretion when CDS gives "a singular output where only one recommendation is clinically appropriate".
  - The time-critical limitation moved from Criterion 3 to Criterion 4.
  - There is more emphasis on "well-understood and accepted sources, such as clinical guidelines and peer-reviewed literature".
  - The guidance "continues to focus exclusively on HCP-facing CDS". It gives no enforcement discretion for patient decision support, chatbots or symptom checkers, and does not address AI.
  - Source: [Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance)
- **[TEXT]** _Policy for Device Software Functions and Mobile Medical Applications_ (issued 28 Sep 2022; first issued 2013), **Appendix B**. This appendix lists functions that "MAY meet the definition of medical device but for which FDA intends to exercise enforcement discretion … because they pose lower risk to the public." Relevant items:
  - Item 6: "Software functions that use patient characteristics such as age, sex, and behavioral risk factors to provide patient-specific screening, counseling, and preventive recommendations from well-known and established authorities."
  - Item 2: "Software functions that provide periodic educational information, reminders, or motivational guidance to pregnant people, smokers trying to quit, or people recovering from addiction."
  - Item 11: "Software functions that keep track of medications and provide user-configured reminders for improved medication adherence."
  - Source: [FDA guidance PDF](https://www.fda.gov/media/80958/download), text extracted from the PDF.
- **[TEXT]** The same guidance lists among **non-device** administrative functions software that "generate[s] reminders for scheduled medical appointments or blood donation appointments" — [FDA guidance PDF](https://www.fda.gov/media/80958/download)
- FDA revised the _General Wellness: Policy for Low Risk Devices_ guidance on **6 Jan 2026**, superseding the Sept 2019 version. It keeps the two-factor test: the product is intended only for general wellness use, and it is low risk — [Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/fda-issues-revised-guidance-on-general-wellness-products); [Troutman](https://www.troutman.com/insights/fdas-2026-guidance-on-general-wellness-devices-policy-for-low-risk-devices/)
- **[TEXT/INTERP]** The 2026 wellness guidance has two categories:
  - (1) "intended solely for maintaining or encouraging a healthy lifestyle", unrelated to disease;
  - (2) "intended to reduce the risk of or help users live well with certain chronic diseases or conditions through healthy lifestyle choices".
- **[TEXT/INTERP]** It allows "a notification informing a user that evaluation by a healthcare professional may be helpful when outputs fall outside ranges appropriate for general wellness use". Wellness products must not reference specific diseases, include clinical thresholds or diagnostic language, or "prompt or guide specific clinical action or medical management, including through alerts or alarms". Source: [Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/fda-issues-revised-guidance-on-general-wellness-products)
- **[INTERP]** The 2026 wellness revision allows some non-invasive wearables that estimate BP, glucose, SpO2 or HRV to count as wellness products if their outputs are wellness-only — [King & Spalding](https://www.kslaw.com/news-and-insights/fda-updates-general-wellness-and-clinical-decision-support-guidance-documents)

**EU: MDR and MDCG**

- **[TEXT]** MDCG 2019-11 **rev.1 is dated June 2025**. Its change log includes: "4.2.1. Addition of clarification to Rule 11 (Subrule a). Addition of references and examples on devices intended to prevent the risk of illness." The document notes it is "not legally binding and only the Court of Justice of the European Union can give binding interpretations" — [MDCG 2019-11 rev.1 PDF](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en)
- **[TEXT]** The MDR device definition, as quoted in MDCG 2019-11, covers software intended for "diagnosis, **prevention**, monitoring, **prediction, prognosis**, treatment or alleviation of disease". Preventive and predictive purposes are therefore explicitly medical purposes — [MDCG 2019-11 rev.1](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en)
- **[TEXT]** MDCG decision steps:
  - **Step 3:** if the software "performs an action beyond storage, archival, communication, simple search, lossless compression … then it may be a MDSW".
  - **Step 4:** "is the action for the benefit of individual patients? Examples of software which are not considered as being for the benefit of individual patients are those which are intended only to aggregate population data, provide **generic diagnostic or treatment pathways (not directed to individual patients)**, scientific literature…"
  - Source: [MDCG 2019-11 rev.1](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en)
- **[TEXT]** "…e-mailing, web or voice messaging, data parsing, word processing, and back-up, **wellness or fitness apps, do not qualify as MDSW**." Also: "the risk of harm to patients … is **not a criterion** on whether the software qualifies as a medical device." Source: [MDCG 2019-11 rev.1](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en)
- **[TEXT]** Listed MDSW examples include:
  - "MDSW app that provides a **10-year risk of cardiovascular disease from data input by a lay user**";
  - "MDSW that … calculates a patient's risk of developing prostate cancer" from age, ultrasound and IVD inputs.
  - Source: [MDCG 2019-11 rev.1](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en)
- **[TEXT]** Rule 11a clarification in rev.1: "a device intended to prevent the risk of illnesses or pathologies by analysing physiological parameters … can be considered as a device providing information which is used to take decisions with diagnosis purpose (potential detection of pathologies) and in this case is in **class IIa**." Where MDSW is intended for lay persons, the Annex I lay-user requirements (22, 23.4(w)) apply — [MDCG 2019-11 rev.1](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en)
- **[INTERP]** Rule 11 structure: 11a covers information for diagnostic or therapeutic decisions (IIa, rising to IIb or III by severity); 11b covers monitoring of physiological processes; 11c covers everything else (class I) — [RegAffairs Hub](https://www.regaffairshub.com/blog/eu-mdr-rule-11-software-classification); [OpenRegulatory](https://openregulatory.com/mdcg/mdcg-2019-11)
- **[TEXT]** MDR Art 2(27): "'making available on the market' means any supply of a device … for distribution, consumption or use on the Union market **in the course of a commercial activity, whether in return for payment or free of charge**" — quoted via [TÜV SÜD MDR text](https://de-mdr-ivdr.tuvsud.com/Chapter-I-Scope-and-definitions.html); primary text: [EUR-Lex 2017/745](https://eur-lex.europa.eu/eli/reg/2017/745/oj) (EUR-Lex not fetched this session)
- **[INTERP]** Johner Institute: code is not a medical device placed on the market if it is not distributed "in the course of a commercial activity". Software offered for download must comply with the MDR whether or not it is free, if the offer is aimed at commercial distribution — [Johner Institute](https://blog.johner-institute.com/regulatory-affairs/placing-on-the-market/)

**UK**

- MHRA's _Medical device stand-alone software including apps (including IVDMDs)_ guidance was last updated **1 July 2023**. It has appendices on symptom checkers and clinical calculators. The gov.uk page lists no 2025–2026 revision — [gov.uk MHRA](https://www.gov.uk/government/publications/medical-devices-software-applications-apps); [flowchart PDF](https://assets.publishing.service.gov.uk/media/64a7d22d7a4c230013bba33c/Medical_device_stand-alone_software_including_apps__including_IVDMDs_.pdf)
- **[INTERP]** The MHRA is reforming software regulation: the AI Airlock pilot finished in March 2025, an AI-specific framework is expected in 2026, and draft 2026 regulations bring in PCCPs for SaMD — [Burges Salmon](https://www.burges-salmon.com/articles/102icot/mhra-publishes-guidance-for-software-and-ai-as-a-medical-device/); [Emergo](https://www.emergobyul.com/news/mhra-publishes-revised-roadmap-future-regulatory-framework-medical-devices)

### Inferences

- **Option A: user-initiated reminders.** The user enters "my next dental/cervical/colonoscopy due date" and the app reminds them. This is close to non-device in the US (appointment reminders) and in the EU (storage and communication, no medical processing). Lowest risk.
- **Option B: age- and sex-filtered display of public guideline text, with citations and links** (for example "USPSTF recommends X for adults 45–75; source, date").
  - In the US this is squarely covered by Appendix B item 6 enforcement discretion.
  - In the EU it is ambiguous. Filtering by the user's own age and sex is arguably "directed to individual patients" (step 4), yet it is close to "generic pathways". Writing the intended purpose as information and education ("shows what public bodies publish for people of your age and sex; it does not assess your risk") lowers the risk but does not settle it. **Needs EU and UK regulatory advice.**
- **Option C: using lab values, family history, BMI or risk scores to trigger or tailor recommendations** (for example "your LDL is X, so discuss statins" or "computed ASCVD risk").
  - US: this is an analysis of medical information for a patient. It is outside the CDS exemption (not HCP-facing) and outside general wellness (it prompts specific clinical action). It may still fit Appendix B item 6 if it only uses "behavioral risk factors" and established-authority rules, but lab-value triggers go beyond the examples given.
  - EU: MDCG's lay-user 10-year CVD risk example makes this very likely class IIa MDSW.
  - Avoid this, or gate it behind a regulated pathway.
- The 2026 FDA wellness guidance allows "evaluation by a healthcare professional may be helpful" prompts, but bans disease-specific and clinical-action language. "Get screened for colorectal cancer" is disease-specific prevention, so it is outside wellness and depends on Appendix B instead.
- **Self-hosted, open-source distribution.**
  - EU and UK: if no entity supplies the app "in the course of a commercial activity" (no hosted SaaS, no paid support, no monetisation), there may be no "placing on the market". Any project or company that offers a hosted instance or paid tier probably becomes a manufacturer.
  - US: the device definition depends on intended use, not commerce. Whether FDA would act against a non-commercial OSS project is unclear.
  - Do not rely on the open-source status alone. Legal advice is needed.
- Under MDR Art 7 (not fetched), misleading claims about a device's intended purpose are prohibited. For non-devices, the intended purpose comes from labelling, promotion and app-store text. Marketing copy, README text and in-app wording all need to stay consistent with an information-only purpose.

### Gaps

- I could not fetch the FDA 2026 CDS and General Wellness guidance PDFs directly. Their details come from law-firm summaries.
- I could not confirm whether FDA updated the 2022 _Device Software Functions/MMA_ guidance in 2025–2026. The PDF I extracted is the 28 Sep 2022 version.
- I found no FDA, MDCG or MHRA text that specifically addresses open-source or self-hosted software.
- I did not review the MHRA guidance PDF appendix on clinical calculators in detail.
- **Portugal:** I found no INFARMED-specific software guidance. The MDR applies directly. INFARMED is the national competent authority (not verified this session).
- The EU AI Act interaction (AI-enabled MDSW counts as high-risk under Art 6(1)) was not researched.

---

## 2. Effectiveness: do patient-directed reminders increase uptake?

### Takeaway

There is high-quality evidence that patient reminder and recall increases vaccination uptake by roughly 8 percentage points. All modalities work, and telephone works best. For cancer screening, personalised invitations and letter or phone reminders improve uptake. Text and SMS reminders have modest, inconsistent effects (0.6–15 points absolute). Some trials show no effect, or even worse uptake, when SMS replaces postal reminders.

### Cited findings

- **Jacobson Vann JC et al.** Patient reminder and recall interventions to improve immunization rates. _Cochrane Database Syst Rev_ 2018;1:CD003941.
  - 75 studies covering children, adolescents and adults in 10 countries.
  - About **8% more people were vaccinated** after a reminder than with no reminder.
  - "All types of patient reminder and recall are likely to be effective"; telephone was most effective.
  - High-quality evidence that postcards, text messages and automated phone calls work.
  - Sources: [Cochrane news](https://www.cochrane.org/about-us/news/reminding-people-about-vaccinations-can-increase-rates-immunization); [Healthy People 2030](https://odphp.health.gov/healthypeople/tools-action/browse-evidence-based-resources/patient-reminder-and-recall-interventions-improve-immunization-rates)
- **Staley H et al. 2021**, Cochrane CD002834.pub3, interventions targeted at women for cervical screening. More personalised invitations (personal invitation, GP letter, fixed appointment) were more successful. Letter and telephone reminders increase uptake — [Cochrane](https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD002834.pub3/full); summary via [Frontiers review](https://www.frontiersin.org/journals/public-health/articles/10.3389/fpubh.2022.1035288/full)
- In general populations, telephone invitations, counselling and prompts after the initial invitation increase cancer screening uptake. For people with severe mental illness there is no high-quality evidence for any intervention (Barley 2016, Cochrane CD009641) — [Cochrane](https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD009641.pub3/full)
- **Text messaging systematic review** (Uy et al., JMIR 2017; 9 studies covering breast, cervical and colorectal screening). Absolute screening rates were **0.6–15.0 points higher**, and relative rates 4–63% higher. Effects were moderate for breast and cervical screening and possibly small for colorectal — [JMIR 2017](https://www.sciencedirect.com/org/science/article/pii/S1438887117002849)
- **TRICCS RCT** (text-message reminders in colorectal screening) — [PMC5520096](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5520096/)
- **M-TICS RCT**, targeted SMS reminders for FIT completion versus control:
  - 64.2% vs 53.7% at 30 days;
  - 78.6% vs 72.0% at 60 days;
  - 82.6% vs 77.7% at 126 days.
  - Source: [PMC11325104](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11325104/)
- **Counter-example RCT:** SMS reminders instead of postal reminders gave _lower_ participation (17.2% vs 21.9%) — [JMIR mHealth 2025, PMC11736219](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11736219/)

### Inferences

- Most of this evidence comes from health-system "recall" (the system knows who is due). OpenValens is a self-tracking app and is not linked to the screening register. Effects in self-selected, health-engaged users of a self-hosted app are probably smaller, because these users already have higher baseline uptake. That is plausible but not demonstrated.
- Design features with support:
  - Personalisation (named test, due date, how to book).
  - A follow-up prompt after an initial reminder.
  - Several channels (the app already has Telegram and email). Phone is strongest, but not feasible in an app.
  - Making it easy to act: a booking link, or "mark as done / snooze / not applicable".
- Reminders should add to national programme invitations, not replace them. The SMS-replacing-post RCT showed harm from substitution.

### Gaps

- I did not find a Cochrane review specifically on **patient portal** reminders for screening.
- I did not fetch effect sizes from the CPSTF Community Guide "client reminders" recommendations for cancer screening.
- I found no RCT of preventive reminders delivered by a self-tracking or PHR consumer app outside a health system.

---

## 3. Shared decision-making for C-grade and individual-decision items

### Takeaway

Decision aids reliably improve knowledge, accuracy of risk perception and decisional conflict, with no adverse effects (Stacey 2017, 105 RCTs). For items like PSA screening, the app should present balanced benefit and harm information and link to an established decision aid. It should frame the item as "a decision to discuss with your clinician", not as a due task with a reminder cadence.

### Cited findings

- **Stacey D et al. 2017**, _Decision aids for people facing health treatment or screening decisions_, Cochrane CD001431.pub5. 105 studies, 31,043 participants. Decision aids:
  - increased knowledge and the accuracy of risk perceptions;
  - reduced decisional conflict about feeling uninformed or unclear about values;
  - reduced the number of people who stayed undecided, and appeared to improve patient–clinician communication;
  - produced no adverse effects on health outcomes or satisfaction;
  - reduced choice of major elective invasive surgery.
  - Sources: [Cochrane](https://www.cochranelibrary.com/cdsr/doi/10.1002/14651858.CD001431.pub5/full); [Ottawa Hospital Research Institute summary](https://decisionaid.ohri.ca/cochsystem.html); [Healthy People 2030](https://odphp.health.gov/healthypeople/tools-action/browse-evidence-based-resources/decision-aids-people-facing-health-treatment-or-screening-decisions)
- There is a later update of the review (Stacey et al., 2024, CD001431.pub6) — [PMC10823577](https://pmc.ncbi.nlm.nih.gov/articles/PMC10823577/). The Cochrane page returned 403, so I could not confirm its effect sizes.
- **[INTERP, linked to section 1]** FDA's 2026 CDS revision gives no enforcement discretion for patient decision-support tools — [Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance)

### Inferences

- Use three visibly different item states, in different UI:
  1. **Routine, guideline-recommended:** due or overdue reminders.
  2. **Individual decision (C-grade, or "discuss"):** no countdown or overdue badge. Show "Talk with your clinician about whether this is right for you", plus links to a validated decision aid (for example the Ottawa A–Z inventory or the source body's patient material). Let the user record "Decided: yes / no / later".
  3. **Not recommended or insufficient evidence:** informational only, with no reminders.
- Linking to established decision aids instead of writing your own reduces content-safety burden and regulatory exposure. A bespoke, personalised benefit and harm calculator could count as MDSW in the EU (see the risk-calculator example in section 1).
- A "decided not to" state is a legitimate end state and should stop reminders. This respects informed choice.

### Gaps

- PSA-specific decision-aid RCT effect sizes were not retrieved, and there is no specific citation for them.
- IPDAS quality criteria for selecting a decision aid were not researched in this session.

---

## 4. Safety governance: clinical content review, versioning, and disclaimers

### Takeaway

- DCB0129 (manufacturer clinical risk management) and DTAC apply when health IT is deployed in or bought by the NHS. They do not legally bind a self-hosted consumer OSS app. They are still the best ready-made template:
  - a named clinical safety officer;
  - a hazard log;
  - a clinical safety case;
  - documented review whenever a guideline changes.
- Both standards are being revised: DTAC v2.0 came out in Feb 2026, and the DCB0129/0160 review is ongoing.
- Disclaimers do not override a device's intended purpose, which is judged from all claims. From 9 Dec 2026, EU product-liability law covers software.

### Cited findings

- NHS England is formally reviewing DCB0129 and DCB0160 to keep them current with EPR rollout and AI. Focus groups ran Jan–Jul 2025, followed by a consultation survey — [NHS England Digital review page](https://digital.nhs.uk/data-and-information/information-standards/governance/latest-activity/standards-and-collections/review-of-digital-clinical-safety-standards-dcb0129-and-dcb0160); [HTN](https://htn.co.uk/2024/12/17/digital-clinical-safety-standards-review-launched-by-nhs-england/); [PSL hub](https://www.pslhub.org/learn/digital-health-and-care-service-provision/regulatory-bodies-standards-guidance/nhs-england-national-review-of-clinical-risk-management-standards-dcb0129-and-dcb0160-r14538/)
- **[INTERP]** DTAC v2.0 was released in **February 2026**. It has about 25% fewer questions and is de-duplicated with DSPT. Reviews of DCB0129/0160 inside DTAC are still ongoing — [search summary of PatientGuard](https://patientguard.com/dcb0129-dtac-clinical-safety/). This is a commercial secondary source; confirm on the NHS England DTAC page.
- A national cross-sectional study of digital health technology compliance with clinical safety standards in the NHS in England — [JMIR 2025, PMC12619009](https://pmc.ncbi.nlm.nih.gov/articles/PMC12619009/). The specific compliance figures were not extracted.
- **[TEXT]** FDA's 2026 CDS guidance puts more weight on "well-understood and accepted sources, such as clinical guidelines and peer-reviewed literature". FDA Appendix B item 6 depends on recommendations "from well-known and established authorities" — [Covington](https://www.cov.com/en/news-and-insights/insights/2026/01/5-key-takeaways-from-fdas-revised-clinical-decision-support-cds-software-guidance); [FDA MMA guidance](https://www.fda.gov/media/80958/download)
- **[TEXT]** The FDA MMA guidance cites, as an example of a disclaimer, "a persistent on-screen notice, such as 'for informational purposes only and not intended for diagnostic use'". This appears in the context of certain HCP reference functions — [FDA guidance PDF](https://www.fda.gov/media/80958/download)
- **[TEXT]** "the risk of harm … is not a criterion on whether the software qualifies as a medical device". Qualification follows the manufacturer's intended purpose, and rev.1 stresses "crafting a clear intended purpose" — [MDCG 2019-11 rev.1](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en)
- EU Product Liability Directive (EU) 2024/2853 brings software into the definition of "product". Member states must apply it from 9 Dec 2026. Free and open-source software developed or supplied outside a commercial activity is excluded (recital 14) — [EUR-Lex](https://eur-lex.europa.eu/eli/dir/2024/2853/oj) (not re-fetched this session; verify the exact wording)
- ORCHA: not researched this session (no source retrieved).

### Inferences

Proposed lightweight governance modelled on DCB0129, for an OSS project:

- **Content as versioned data.** Each rule records:
  - source body, document title, URL and publication date;
  - recommendation grade;
  - jurisdiction (US, UK or PT/EU);
  - population criteria;
  - `content_version`;
  - `reviewed_by` and `reviewed_at`;
  - `next_review_due`.
- This fits the repo's provenance rules.
- **Show provenance in the UI.** Every recommendation shows "Source: USPSTF, 2024" with a link and a "last reviewed" date.
- **Watch for guideline changes.** Track source bodies (USPSTF, NHS screening programmes, DGS Portugal, ECDC/EU Council recommendation). Set a maximum review age, for example 12 months. Auto-flag content as "stale" when review is overdue and suppress reminders rather than show outdated advice.
- **Hazard log entries:**
  - wrong population match;
  - stale guideline;
  - user enters wrong DOB or sex;
  - false reassurance ("nothing due");
  - pregnancy or other contexts where defaults are wrong;
  - notification channel failure;
  - jurisdiction mismatch.
- **Named clinical reviewer.** Require a clinician with a documented sign-off for each content release. This is effectively a clinical safety officer role, even if not legally required.
- **Changelog.** Notify users when a recommendation that affects them changes.
- **Disclaimers.** "Not medical advice" text does not stop qualification as MDSW or SaMD if functions and claims show a medical purpose. Disclaimers are also only partly effective against liability. **Legal advice is needed** on the US (state tort), UK (Consumer Protection Act 1987) and EU PLD 2024/2853 position for a project that has a hosted or commercial arm.

### Gaps

- I could not fetch the DCB0129 standard page (403). Its specifications and its legal basis (Health and Social Care Act 2012 s250) are not verified this session.
- I did not verify DTAC v2.0 on an NHS page.
- ORCHA's review criteria were not researched.
- I found no regulation that sets a mandatory update interval when guidelines change for non-device software. Post-market obligations (MDR Art 83–86, vigilance) apply only if the software is a device.

---

## 5. Data handling: risk factors such as smoking, pregnancy and family history

### Takeaway

Under GDPR, smoking history, pregnancy and family history are "data concerning health" and so special-category data. Family history also contains health data about third parties (relatives). Processing for consumer self-tracking needs explicit consent (Art 9(2)(a)), purpose limitation, minimisation and a DPIA. In the US, the FTC Health Breach Notification Rule (amended 2024) covers non-HIPAA health apps that draw data from multiple sources.

### Cited findings

- **[TEXT]** GDPR (Regulation (EU) 2016/679) provisions:
  - Art 4(15): "data concerning health" means personal data on physical or mental health, including healthcare services, that reveal health status.
  - Art 9(1): processing of data concerning health is prohibited unless an Art 9(2) exception applies, for example (a) explicit consent for specified purposes.
  - Art 5(1)(b): purpose limitation. Art 5(1)(c): data minimisation.
  - Art 25: data protection by design and by default.
  - Art 35: DPIA for large-scale special-category processing.
  - Art 2(2)(c): household exemption for purely personal activity.
  - Source: [EUR-Lex GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj) (not re-fetched this session)
- **[TEXT/INTERP]** FTC Health Breach Notification Rule, final rule published 30 May 2024 and effective 29 July 2024:
  - It brings health apps and direct-to-consumer health tech into scope.
  - It defines a PHR as "an electronic record of PHR identifiable health information on an individual that has the technical capacity to draw information from multiple sources".
  - "Breach" includes unauthorised disclosure, not only hacking.
  - Sources: [Federal Register](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule); [FTC press release](https://www.ftc.gov/news-events/news/press-releases/2024/04/ftc-finalizes-changes-health-breach-notification-rule)

### Inferences

- **Self-hosting.** A person who self-hosts for their own use is probably within the household exemption. An operator who hosts for other people (family, clients, organisations) is a controller. That operator needs an Art 9(2) basis, in practice explicit consent, plus a DPIA.
- **Project role.** The OSS project itself is not a controller unless it runs a hosted service or telemetry.
- **Purpose limitation.** Collect a risk factor only when a specific displayed rule needs it. Store it with a `purpose` tag. Do not reuse it for AI features without separate consent. This matches the repo rule that AI must be consent-gated and PHI-minimised.
- **Make fields optional, with clear "why we ask" text.** Pregnancy is sensitive and can change; it should expire or require reconfirmation. Smoking pack-years should be stored as the user entered them, with provenance.
- **Family history** is about relatives, who are data subjects with no relationship to the app. Keep it coarse (for example "first-degree relative with colorectal cancer < 60: yes/no") and never share it.
- **Minimisation also lowers regulatory risk.** The fewer clinical inputs that drive recommendations, the stronger the case for "generic information" under MDCG step 4 and FDA Appendix B item 6.
- **US operators.** If they offer hosted instances that import from several sources (Health Connect, labs, calendar), they are likely PHR vendors under the FTC HBNR. **Legal advice is needed.**
- **Portugal.** The supervisory authority is CNPD (not verified this session). Lei 58/2019 implements the GDPR (not verified this session).

### Gaps

- I did not retrieve EDPB guidance specific to health apps or consent in wellness apps.
- I did not research US state consumer-health privacy laws, such as Washington's My Health My Data Act, which may apply to consumer health data.
- UK GDPR / DPA 2018 Schedule 1 conditions for health data were not researched.
