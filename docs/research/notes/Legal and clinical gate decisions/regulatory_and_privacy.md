# Regulatory and privacy gate decisions for OpenValens (GDPR, FTC HBNR, EU MDR / FDA, health claims, non-clinician governance)

Research date: 2026-10-02. Researcher: AI agent (no lawyer or clinician involved, by design).
Status labels used below: **[BINDING]** = statute/regulation/CJEU judgment; **[GUIDANCE]** = official non-binding regulator/MDCG/Commission guidance; **[COMMENTARY]** = law-firm/vendor/secondary; **[NOT FETCHED]** = cited from prior knowledge, not re-verified in this session (verify before quoting verbatim).
Deployment types: **D1** household self-hosting; **D2** self-hoster serving others (friends, clients, community); **D3** hosted service run by the maintainer (natural person in Portugal), possibly with US users. **P** = the OSS project as publisher of AGPL code (not an operator).

Method note: verbatim text was extracted from the Publications Office (cellar) copies of GDPR, MDR, CRA, UCPD, Blue Guide 2022 and Ryneš; from govinfo's HTML of the 2024 HBNR final rule (89 FR 47028); from the FDA PDF of the 2026 General Wellness guidance; from the MDCG 2019-11 rev.1 PDF; and from the CNPD Regulamento 1/2018 PDF. EUR-Lex and federalregister.gov HTML were blocked by bot protection, so the URLs below point to the canonical pages; the text came from the same official documents.

---

## 1. GDPR roles and obligations per deployment type (#89)

### Takeaway

D1 is plausibly out of GDPR under the household exemption. It has to be "purely" personal or household and is read narrowly (Ryneš). D2 is in scope as soon as the person serves anyone outside their own household setting, and certainly when there is any professional or commercial element. D3 makes the maintainer a full controller for Art. 9 health data: explicit consent, Art. 30 records (the SME exemption does not apply to Art. 9 data), 72-hour breach notification, and a DPIA, which CNPD's list makes mandatory for wearable-transmitted health data. A DPO is probably not mandatory at small scale. P is not a controller of anyone's data, but Recital 18 means a party that "provides the means" for household processing (for example, a hosted service) is still covered.

### Cited Findings

- **[BINDING] GDPR Recital 18**: "This Regulation does not apply to the processing of personal data by a natural person in the course of a purely personal or household activity and thus with no connection to a professional or commercial activity. Personal or household activities could include correspondence and the holding of addresses, or social networking and online activity undertaken within the context of such activities. However, this Regulation applies to controllers or processors which provide the means for processing personal data for such personal or household activities." See [GDPR, Reg. (EU) 2016/679](https://eur-lex.europa.eu/eli/reg/2016/679/oj). Art. 2(2)(c) has the same "purely personal or household activity" wording.
- **[BINDING] CJEU C-212/13 Ryneš (11 Dec 2014)**, para 29: the exception "must be narrowly construed". Para 30: the narrow reading follows from the word "'purely' personal or household activity, that is to say, not simply a personal or household activity". Para 31: the exception applies "only where it is carried out in the purely personal or household setting of the person processing the data". Para 33: activity "directed outwards from the private setting" is not purely personal. See [Ryneš, CELEX 62013CJ0212](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62013CJ0212).
- **[BINDING][NOT FETCHED] CJEU C-101/01 Lindqvist (2003), para 47**: the exception covers only "activities which are carried out in the course of private or family life of individuals", which is "clearly not the case" for publication on the internet to "an indefinite number of people". See [Lindqvist, CELEX 62001CJ0101](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62001CJ0101).
- **[BINDING] Territorial scope, Art. 3(1)**: GDPR "applies to the processing of personal data in the context of the activities of an establishment of a controller or a processor in the Union, regardless of whether the processing takes place in the Union or not". A Portugal-based operator is therefore covered for US users too. See [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj).
- **[BINDING] Art. 9(2)(a)**: processing of health data is allowed where "the data subject has given explicit consent to the processing of those personal data for one or more specified purposes, except where Union or Member State law provide that the prohibition ... may not be lifted by the data subject". See [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj).
- **[BINDING] Art. 12(3)**: action on Art. 15–22 requests must be provided "without undue delay and in any event within one month of receipt". This "may be extended by two further months where necessary", and the data subject must be informed of the extension within one month. Electronic requests get electronic answers where possible. See [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj).
- **[BINDING] Art. 20 (portability) [NOT FETCHED verbatim]**: this applies where processing is based on consent (Art. 9(2)(a) included) and carried out by automated means. Data the subject "provided" must be returned in a "structured, commonly used and machine-readable format". See [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj).
- **[BINDING] Art. 30(5)**: the records-of-processing exemption for organisations with fewer than 250 employees does not apply if processing "is not occasional, or the processing includes special categories of data as referred to in Article 9(1)". D3 therefore must keep Art. 30 records. See [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj).
- **[BINDING] Art. 33(1)**: notify the supervisory authority "without undue delay and, where feasible, not later than 72 hours after having become aware of it, ... unless the personal data breach is unlikely to result in a risk". **Art. 34(1)**: tell data subjects "without undue delay" when the breach is "likely to result in a high risk". See [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj).
- **[BINDING] Art. 35(3)(b)**: a DPIA is required for "processing on a large scale of special categories of data". **Recital 91**: processing "should not be considered to be on a large scale if the processing concerns personal data from patients or clients by an individual physician, other health care professional or lawyer". See [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj).
- **[BINDING – national list under Art. 35(4)] CNPD Regulamento n.º 1/2018** (DR 2.ª série n.º 231, 30 Nov 2018) makes a DPIA mandatory, regardless of scale, for:
  - "1 — Tratamento de informação decorrente da utilização de dispositivos eletrónicos que transmitam, por redes de comunicação, dados pessoais relativos à saúde"
  - "2 — Interconexão de dados pessoais ou tratamento que relacione dados pessoais previstos no n.º 1 do artigo 9.º ... ou dados de natureza altamente pessoal"
  - "4 — ... criação de perfis em grande escala"

  The list states it is non-exhaustive and is based on WP248 rev.01. See [CNPD Regulamento 1/2018 (PDF)](https://www.cnpd.pt/umbraco/surface/cnpdDecision/download/121818).

- **[BINDING] Art. 37(1)(c)**: a DPO is mandatory where "core activities ... consist of processing on a large scale of special categories". Recital 97 says core activities "relate to its primary activities". See [GDPR](https://eur-lex.europa.eu/eli/reg/2016/679/oj).
- **[BINDING][NOT FETCHED] Lei n.º 58/2019** (Portuguese GDPR implementing law) has a digital-consent age of 13 (Art. 16) and specific health-data rules (Art. 29). The confidentiality duty in Art. 29 is understood to attach to processing under Art. 9(2)(h)/(i). CNPD is the supervisory authority. See [Lei 58/2019, Diário da República](https://diariodarepublica.pt/dr/detalhe/lei/58-2019-123815982). The Art. 29 wording was not verified this session.

### Inferences

**Recommended decision (per deployment):**

- **P (OSS project)**: not a controller or processor, because it never receives user data. Obligations are ethical and product-level: ship privacy-by-default code (Art. 25 is addressed to controllers, but D2/D3 operators need it). Ship templates: a privacy notice, an Art. 30 record template, a DPIA template pre-filled for the CNPD list items 1/2/4, and a breach runbook. The README must contain: "If you host OpenValens for anyone outside your own household, you are a GDPR controller for their health data." The project must not run telemetry or crash reporting that carries health data. Any opt-in project telemetry must be non-personal, or the project becomes a controller.
- **D1 (household)**: treat as exempt only if (a) a natural person runs it, (b) users are the operator's own household or family, (c) no fee, no professional use, no public sign-up, and (d) data is not exposed to an indefinite audience. Ryneš paras 31 and 33 and Lindqvist para 47 support this test. Note that third-party processors used by the self-hoster (cloud VPS, AI API) are not exempt themselves (Recital 18, last sentence).
- **D2 (self-hoster serving others)**: the exemption is lost the moment users include anyone outside the operator's private or family setting, any payment or professional context exists (a coach, trainer, clinic or employer), or sign-up is open. Conservative rule: anyone beyond the operator's own household equals controller. A small group of friends is ambiguous and, by inference, likely not "purely" household under the narrow-construction rule. The app should show a first-run "operator mode" question. If the instance serves others, it enables the consent flow, privacy-notice template, export and delete tooling, and an audit log.
- **D3 (maintainer-hosted)**: the maintainer is the controller and must:
  - use Art. 9(2)(a) explicit consent, separate per purpose, for (i) core storage and (ii) AI coach processing (with sub-processor named), and for (iii) any wearable sync;
  - answer DSARs within 1 month, with an Art. 20 machine-readable export (JSON/CSV/FHIR) and self-serve deletion;
  - keep Art. 30 records;
  - meet 72-hour CNPD breach notification and Art. 34 user notice;
  - complete a mandatory DPIA before launch (CNPD items 1/2, also Art. 35(1) high risk), and a prior consultation with CNPD under Art. 36 if residual high risk remains;
  - sign Art. 28 DPAs with hosting and AI vendors, plus Chapter V transfer tools for any US sub-processor;
  - record a "no DPO required (not large scale)" assessment, re-reviewed at a user-count threshold. Suggested conservative trigger (inference, not law): roughly 1,000 active users or any B2B or clinic use. Alternatively, appoint a DPO voluntarily.
  - US users are fully covered by GDPR (Art. 3(1)), so apply one standard globally.

**Residual risk:** "Small group of friends" D2 deployments sit in a grey zone that no CJEU case squarely decides. "Large scale" for Art. 37 has no numeric threshold.

### Gaps

- EDPB Guidelines 07/2020 (controller/processor) and WP243 rev.01 (DPO, "large scale" factors) were not fetched. The numeric DPO trigger above is a conservative inference, not law.
- No CJEU or EDPB ruling found on self-hosted multi-user apps for friends or family. Later CJEU cases (e.g., C-25/17 Jehovan todistajat, 2018) refine the household test but were not fetched.
- Lei 58/2019 Arts. 16 and 29 were not verified verbatim.
- Whether the AGPL obligation to offer source to network users creates any privacy duty: none found. Inference: no.

---

## 2. FTC Health Breach Notification Rule (16 CFR Part 318, as amended 2024) (#89, #97)

### Takeaway

OpenValens squarely fits the amended definition of a "personal health record". It tracks fitness, sleep, diet and labs and draws data from multiple sources (wearables, Health Connect, calendar). The rule by its terms "applies to foreign and domestic vendors ... irrespective of any jurisdictional tests in the FTC Act, that maintain information of U.S. citizens or residents". D3 with US users is therefore in scope on paper. Enforcement against an individual in Portugal is practically unlikely, but compliance by design costs little, so D3 should comply. P is not a vendor. D1 and D2 are technically ambiguous, and the FTC has never addressed them.

### Cited Findings

- **[BINDING] § 318.1(a)**: "This part applies to foreign and domestic vendors of personal health records, PHR related entities, and third party service providers, irrespective of any jurisdictional tests in the Federal Trade Commission (FTC) Act, that maintain information of U.S. citizens or residents." See [16 CFR 318 as published, 89 FR 47028 (May 30, 2024)](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule) and [eCFR Part 318](https://www.ecfr.gov/current/title-16/chapter-I/subchapter-C/part-318). The amendments took effect **July 29, 2024**.
- **[BINDING] § 318.2 "Breach of security"**: "acquisition of such information without the authorization of the individual". Unauthorized access is presumed to be acquisition unless there is "reliable evidence" otherwise. "A breach of security includes an unauthorized acquisition ... that occurs as a result of a data breach or an unauthorized disclosure." See [89 FR 47028](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule).
- **[BINDING] § 318.2 "Health care services or supplies"**: "any online service such as a website, mobile application, or internet-connected device that provides mechanisms to track diseases, health conditions, diagnoses or diagnostic testing, treatment, medications, vital signs, symptoms, bodily functions, fitness, fertility, sexual health, sleep, mental health, genetic information, diet, or that provides other health-related services or tools". An entity furnishing these is a "covered health care provider", so data it collects is "PHR identifiable health information". This includes "information that is provided by or on behalf of the individual". See [89 FR 47028](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule).
- **[BINDING] § 318.2 definitions**:
  - "Personal health record" means "an electronic record of PHR identifiable health information on an individual that has the technical capacity to draw information from multiple sources and that is managed, shared, and controlled by or primarily for the individual".
  - "Vendor of personal health records" means "an entity, other than a HIPAA-covered entity ..., that offers or maintains a personal health record".

  See [89 FR 47028](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule).

- **[GUIDANCE – rule preamble]** Example 1: "Diet and fitness app Y allows users to sync their app with third-party wearable fitness trackers ... has the technical capacity to draw identifiable health information both from the user ... and the fitness tracker ..., even if some users elect not to connect the fitness tracker" is a PHR. Example 2: pulling from the phone calendar API is also enough. The preamble says the definition covers "wellness issues (... 'fitness, sleep, and diet')". See [89 FR 47028](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule).
- **[GUIDANCE – preamble]** "Authorization" is not defined. The FTC points to its GoodRx and Easy Healthcare orders: disclosures "inconsistent with a company's privacy promises constitute an unauthorized disclosure", and dark patterns do not give "meaningful choice". Penalties in those cases were $1.5M (GoodRx) and $100,000 (Easy Healthcare). See [89 FR 47028](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule).
- **[BINDING] §§ 318.3–318.5 notice duties**:
  - Notify each affected US citizen or resident, the FTC, and prominent media where 500+ residents of a State are affected.
  - Individual and media notice must come "without unreasonable delay and in no case later than 60 calendar days after the discovery".
  - FTC notice for 500+ individuals must be "contemporaneously" with individual notice. Fewer than 500 may be logged and sent annually within 60 days of year-end.
  - Email notice must be "Clear and Conspicuous". "Electronic mail" means email plus text, in-app message, or banner.
  - A breach counts as discovered on the first day it "reasonably should have been known".

  See [89 FR 47028](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule).

- **[BINDING] § 318.7**: violations are treated as violations of an FTC Act § 18 rule, "and thus subject to civil penalties (as adjusted for inflation)". See [89 FR 47028](https://www.federalregister.gov/documents/2024/05/30/2024-10855/health-breach-notification-rule).
- **[BINDING] 15 U.S.C. § 45(a)(4)(A)**: "unfair or deceptive acts or practices" include acts "involving foreign commerce that (i) cause or are likely to cause reasonably foreseeable injury within the United States; or (ii) involve material conduct occurring within the United States". See [15 U.S.C. 45, LII](https://www.law.cornell.edu/uscode/text/15/45).

### Inferences

**Recommended decision:**

- **D3**: comply by design if any US resident can sign up. Concretely:
  - Never send health data to ad, analytics, or attribution SDKs. Unauthorized disclosure is a "breach", and this is the GoodRx and Easy Healthcare pattern.
  - Name every sub-processor (for example, the AI provider) in the privacy notice. Gate each one behind explicit opt-in, so sharing is "authorized".
  - Keep a breach log with discovery timestamps.
  - Use a notice template that meets § 318.6 content and "Clear and Conspicuous" rules, sent by email plus in-app banner.
  - Run one combined incident clock: CNPD 72h, FTC/individuals no later than 60 days, with FTC notice contemporaneous for 500+.
  - Encrypt data with a separately stored key. Data that is not "unsecured" under HHS guidance falls outside the notice duty.
  - Store US-residency of the user, or simply notify everyone.
- **Alternative**: geo-block US sign-ups. This is weaker, because the rule keys on "U.S. citizens or residents", not location.
- **P**: not a vendor, because it neither "offers" nor "maintains" a PHR. It only publishes code. Ship the breach-notice template and the no-tracking default to help operators.
- **D2 in the US, or serving US residents**: a self-hoster offering the app to others is plausibly a "vendor" (an "entity" that "offers or maintains" a PHR). Document this in the self-hosting guide.
- **D1**: maintaining your own and your family's records is very unlikely to be an enforcement target. The FTC has not addressed it, so mark it as unknown but negligible.

**Residual risk:** Practical FTC enforcement against an EU-resident individual is unlikely, though § 318.1 claims the reach and civil penalties exist. The real exposure is reputational, plus app-store and US-partner requirements.

### Gaps

- No FTC statement found on individuals, hobbyists, or open-source self-hosters as "vendors". The rule does not define "entity".
- The FTC's reasoning in the 2009 rule for the "irrespective of jurisdictional tests" clause (understood to reach non-profits) was not fetched.
- Current inflation-adjusted per-violation penalty amount (16 CFR 1.98): not fetched.
- No known FTC HBNR action against a foreign individual operator.

---

## 3. EU MDR scope, OSS / free-service status, and FDA wellness / software policy (#97, #99, #66)

### Takeaway

Under the MDR, qualification turns on the manufacturer's intended purpose, as shown by labels, instructions, promotional material and statements. A wellness, fitness and record-keeping app that stores, displays and trends data and shows authority recommendations verbatim can be framed outside MDSW. That holds only while it makes no individual diagnostic or prevention claim and does not interpret values against clinical thresholds. MDCG rev.1 states that devices "intended to prevent the risk of illnesses ... by analysing physiological parameters" are class IIa MDSW.

FOSS does not automatically escape the MDR. The MDR has no OSS carve-out. "Making available" covers supply "in the course of a commercial activity, whether in return for payment or free of charge". The Blue Guide test is "business related context", judged case by case. The CRA's "not monetised" test is persuasive by analogy, but the MDR does not contain it. A free hosted service could still trigger MDR Art. 6(2) if it provides a "diagnostic or therapeutic service" in a commercial context. The decisive control is therefore intended purpose and claims, not price or licence.

The FDA's January 6, 2026 General Wellness guidance explicitly covers tracking apps, and allows the "may help reduce the risk of" framing for well-accepted lifestyle-disease links.

### Cited Findings

- **[BINDING] MDR Art. 2(1)**: a "medical device" is software etc. "intended by the manufacturer to be used ... for ... specific medical purposes: — diagnosis, prevention, monitoring, prediction, prognosis, treatment or alleviation of disease ...". **Art. 2(12)**: "'intended purpose' means the use for which a device is intended according to the data supplied by the manufacturer on the label, in the instructions for use or in promotional or sales materials or statements and as specified by the manufacturer in the clinical evaluation". See [MDR, Reg. (EU) 2017/745](https://eur-lex.europa.eu/eli/reg/2017/745/oj).
- **[BINDING] MDR Art. 2(27)**: "'making available on the market' means any supply of a device, other than an investigational device, for distribution, consumption or use on the Union market in the course of a commercial activity, whether in return for payment or free of charge". **Art. 2(28)**: placing on the market is "the first making available". **Art. 2(30)**: a manufacturer is "a natural or legal person who manufactures ... or has a device designed ... and markets that device under its name or trademark". See [MDR](https://eur-lex.europa.eu/eli/reg/2017/745/oj).
- **[BINDING] MDR Art. 6(1)**: "A device offered by means of information society services ... to a natural or legal person established in the Union shall comply with this Regulation." **Art. 6(2)**: "a device that is not placed on the market but used in the context of a commercial activity, whether in return for payment or free of charge, for the provision of a diagnostic or therapeutic service offered by means of information society services ... shall comply". **Art. 7** prohibits claims that mislead about intended purpose. See [MDR](https://eur-lex.europa.eu/eli/reg/2017/745/oj).
- **[GUIDANCE] Blue Guide 2022, § 2.2**: "Commercial activity is understood as providing goods in a business related context. Non-profit organisations may be considered as carrying out commercial activities if they operate in such a context. This can only be appreciated on a case by case basis taking into account the regularity of the supplies, the characteristics of the product, the intentions of the supplier, etc. In principle, occasional supplies by charities or hobbyists should not be considered as taking place in a business related context." The Blue Guide contains no statement on open-source software. A search-engine summary claiming otherwise appears to conflate it with CRA material. Its software paragraph (§ 2.1) notes that under the MDR, "software in its own right presenting certain features is considered as a medical device". See [Blue Guide 2022, OJ C 247, 29.6.2022](<https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:52022XC0629(04)>).
- **[BINDING – analogy only] CRA Reg. (EU) 2024/2847, Recital 18**: "the provision of products with digital elements qualifying as free and open-source software that are not monetised by their manufacturers should not be considered to be a commercial activity". Also: "the mere presence of regular releases should not in itself lead to the conclusion" of commercial activity, and the CRA "does not apply to natural or legal persons who contribute with source code". **Recital 20**: "The sole act of hosting products ... on open repositories ... does not in itself constitute the making available on the market." **Art. 3(14)**: an OSS steward is "a legal person, other than a manufacturer, that has the purpose or objective of systematically providing support on a sustained basis for the development of specific products ... qualifying as free and open-source software and intended for commercial activities". A natural person therefore cannot be a steward. **Recital 12**: SaaS falls under NIS2, not the CRA, unless it is remote data processing for a product. See [CRA](https://eur-lex.europa.eu/eli/reg/2024/2847/oj).
- **[GUIDANCE] MDCG 2019-11 rev.1 (June 2025)**:
  - "Crafting a well-defined and clear intended purpose is paramount".
  - Software "only intended for non-medical purposes ... such as ... wellness or fitness apps, do not qualify as MDSW".
  - "'Simple search' ... retrieval of information does not qualify as MDSW (e.g. library functions)".
  - Decision step 3: software that does nothing beyond "storage, archival, communication, simple search, lossless compression" is not MDSW.
  - Decision step 4: software that only provides "generic diagnostic or treatment pathways (not directed to individual patients), scientific literature, medical atlases, models and templates" is not "for the benefit of individual patients".
  - Annex I c.1: EHR systems "used solely to replace traditional paper-based patient files, do not meet the definition of a medical device", but "modules ... may qualify as MDSW if they fulfil a medical purpose".
  - New in rev.1, Rule 11(a): "a device intended to prevent the risk of illnesses or pathologies by analysing physiological parameters (e.g. ... analysis of arterial stiffness ...) can be considered as a device providing information which is used to take decisions with diagnosis purpose (potential detection of pathologies) and in this case is in class IIa".
  - Also: "the risk of harm ... is not a criterion on whether the software qualifies as a medical device".
  - The document states it is not legally binding.

  See [MDCG 2019-11 rev.1 (PDF)](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en?filename=mdcg_2019_11_en.pdf).

- **[GUIDANCE] FDA, General Wellness: Policy for Low Risk Devices**, issued January 6, 2026 (supersedes 2019), "Contains Nonbinding Recommendations":
  - **Two categories:** (1) "maintaining or encouraging a general state of health or a healthy activity", or (2) "the role of healthy lifestyle with helping to reduce the risk or impact of certain chronic diseases or conditions". Category (2) must be "specifically expressed as 'may help to reduce the risk of,' or 'may help living well with'", with the association "generally accepted ... described in peer-reviewed scientific publications or official statements made by healthcare professional organizations".
  - **Covered examples:** fitness trackers that "log, track, or trend exercise activity", "track sleep trends", and food-logging for weight management (Example 3). Example 4 is a reminder about sun exposure "which, as part of a healthy lifestyle, may help reduce the risk of skin cancer". Wellness products "may display values, ranges, trends, baselines, or longitudinal summaries".
  - **Outside the policy** if labeling or UI includes "1. references to specific diseases, clinical conditions, or diagnostic thresholds; 2. alerts, alarms, or prompts that recommend or require specific clinical action or medical management; 3. treatment guidance ...; 4. claims of clinical equivalence, clinical accuracy, medical or clinical grade ...; 5. intended-use statements that explicitly target diagnosis, screening, monitoring, or management of a disease". Also outside if intended for "screening, diagnosis, monitoring, alerting, or management of a disease".
  - **Allowed:** a notification "that evaluation by a healthcare professional may be helpful" if it does "not identify or name a specific disease", does "not characterize the output as abnormal", and does "not include clinical thresholds".
  - **Statutory anchor:** FD&C Act § 520(o)(1)(B) excludes software "for maintaining or encouraging a healthy lifestyle and ... unrelated to the diagnosis, cure, mitigation, prevention, or treatment of a disease or condition".

  See [FDA General Wellness guidance (PDF)](https://www.fda.gov/media/90652/download) and [landing page](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/general-wellness-policy-low-risk-devices).

- **[GUIDANCE][NOT FETCHED] FDA, Policy for Device Software Functions and Mobile Medical Applications** (2022 version) lists two relevant groups:
  - Functions that are not devices or are under enforcement discretion: tools to "organize and track" health information, "easy access to information related to patients' health conditions", and reminders.
  - Under § 520(o)(1)(D): electronic patient records functions, provided they do not interpret or analyse.

  Whether that guidance was updated in 2026 was not checked. See [FDA Device Software Functions guidance](https://www.fda.gov/regulatory-information/search-fda-guidance-documents/policy-device-software-functions-and-mobile-medical-applications).

- **[COMMENTARY]** Law-firm summaries agree the 2026 revision broadened wellness for non-invasive sensing. "Physiologic measurement alone no longer determines regulatory status; interpretation does." See [Covington, Jan 2026](https://www.cov.com/en/news-and-insights/insights/2026/01/fda-issues-revised-guidance-on-general-wellness-products) and [Faegre Drinker](https://www.faegredrinker.com/en/insights/publications/2026/1/key-updates-in-fdas-2026-general-wellness-and-clinical-decision-support-software-guidance).

### Inferences

**On OSS / free hosting:**

- Publishing AGPL source on a public repository with no monetisation is very likely not "making available on the market" (CRA Recitals 18 and 20 by analogy; Blue Guide "hobbyist" language). But the MDR has no explicit OSS exemption, and the maintainer is "a natural person who ... has a device designed" and would be the "manufacturer" if the intended purpose were medical.
- A free D3 hosted service run regularly, under a brand, with a landing page and sign-ups looks more like a "business related context". This is especially so if it is later monetised, donation-backed with perks, or used to build reputation. Treat D3 as potentially "commercial activity" and rely on non-medical intended purpose as the real defence.

**On preventive-care reminders:**

- Displaying an authority's population-level recommendation, filtered by age and sex, is arguably "generic ... pathways (not directed to individual patients)" or "simple search" (MDCG step 3/4). Filtering by the user's age and sex makes it individual-facing, which is a grey zone.
- Risk rises sharply if the app combines the user's own lab values, BMI, family history or risk scores to decide eligibility, urgency or "overdue" status. That is "analysing physiological parameters" to "prevent the risk of illnesses", which rev.1 treats as class IIa.

**Recommended intended-purpose statement** (put identically in the README, landing page, in-app About, and app-store listings):

> "OpenValens is a personal record-keeping and general-wellness app. It helps you store, organise and view your own health-related records (such as lab results you enter or import, body measurements, workouts, nutrition, sleep and wearable data) and track healthy habits. It shows publicly available guidance published by recognised public-health authorities, attributed and unaltered, for your information. OpenValens is not a medical device. It is not intended to diagnose, screen for, prevent, monitor, predict, treat or alleviate any disease or condition, and it does not provide medical advice. Talk to a qualified healthcare professional about your health."

**Never-add list.** Each item would change the intended purpose or put the app outside the FDA wellness policy:

1. Flagging lab values as "abnormal", "high" or "low", or applying clinical reference ranges or thresholds with colour-coded risk. Showing the lab's own printed reference range verbatim as stored data, unlabelled by the app, is the safest form.
2. Any risk score or risk calculator: CVD/ASCVD, FINDRISC, FRAX, "biological age" framed as health risk, disease probability.
3. Eligibility or urgency logic for screenings that uses lab results, vitals or diagnoses (anything beyond age, sex and user-declared authority criteria shown as the authority's own text).
4. Naming a disease in an alert or prompt ("you may have prediabetes"), or prompts to take clinical action ("see a doctor about your blood pressure", "start/adjust medication").
5. Medication dosing, titration, interaction checking, or adherence features framed as treatment management. A plain user-set reminder with no clinical logic is the boundary.
6. AI coach outputs that interpret the user's results diagnostically, suggest diagnoses, triage, or recommend treatment.
7. Claims of "clinical-grade", "medically accurate", "doctor-approved", "detects", "screens", "prevents [disease]", or "early warning".
8. Arrhythmia, AFib, ECG interpretation, SpO2 or BP alerts for disease. Continuous "monitoring" of a condition.
9. Features aimed at clinicians making decisions about patients (a D2 coach or clinic dashboard with interpretation).
10. Marketing the app as a tool to "manage" a named chronic disease, rather than the FDA-permitted "may help living well with", which EU MDR does not explicitly endorse.

**FDA posture:** With the statement above and the never-add list, OpenValens fits FDA wellness category (1). It could use category (2) phrasing only verbatim ("may help reduce the risk of ..."). Do not rely on category (2) in EU copy, because the MDR's "prevention" purpose has no equivalent wellness safe harbour.

**Residual risk:** Age- and sex-filtered screening reminders are an unadjudicated grey zone under MDCG step 4. A regulator could view personalised "due now" prompts as individual prevention, so keep them as attributed, informational listings without urgency language.

### Gaps

- No Commission or MDCG statement found specifically on open-source medical software or "free hosted service = commercial activity" under the MDR. MDCG 2021-27 rev.1 and the Borderline Manual were not searched for OSS language.
- No MDCG example squarely on "display public-health screening schedules filtered by age and sex".
- The FDA Device Software Functions guidance and the 2026 CDS guidance were not re-fetched.
- The EU AI Act (Reg. 2024/1689) interplay for the AI coach was not researched. An AI system that is an MDR device safety component would be high-risk. A wellness-only coach likely carries only Art. 50 transparency duties. This is unverified.
- The MDR Art. 2(1) "prediction, prognosis" wording increases risk for any trend-based forecasting feature (e.g., "projected HbA1c"). No guidance found on wellness-framed forecasts.

---

## 4. Health and marketing claims: banned and allowed wording (#66, #99)

### Takeaway

In the US, any health-benefit claim needs "competent and reliable scientific evidence", generally RCTs, and disclaimers do not cure deceptive claims. In the EU, the UCPD bans misleading claims about product benefits and, per se, false claims that a product "is able to cure illnesses". MDR Art. 7 separately bans misleading device-purpose claims, and claims can themselves create a medical intended purpose (Art. 2(12)). The safe strategy is functional and descriptive copy only: what the software does, not what health outcome it produces.

### Cited Findings

- **[GUIDANCE] FTC Health Products Compliance Guidance (Dec 2022)**:
  - § III.B: competent and reliable scientific evidence means "tests, analyses, research, or studies that (1) have been conducted and evaluated in an objective manner by experts in the relevant disease, condition, or function ...; and (2) are generally accepted in the profession to yield accurate and reliable results".
  - § III.B.2: "randomized, controlled human clinical trials (RCTs) ... are generally the type of substantiation that experts would require for health benefit claims".
  - Scope covers apps and all marketing channels.
  - § III.A.3: a disclosure "should not be contradicted or mitigated by" the rest of the ad. Disclaimers will not "cure an otherwise deceptive ad".
  - § III.C.1: endorsements require substantiation of the implied efficacy claim.

  Underlying law: FTC Act §§ 5 and 12 (binding). See [FTC Health Products Compliance Guidance](https://www.ftc.gov/business-guidance/resources/health-products-compliance-guidance).

- **[BINDING] UCPD 2005/29/EC**:
  - Art. 6(1): a practice is misleading if it "deceives or is likely to deceive the average consumer, even if the information is factually correct", including on "the main characteristics of the product, such as ... benefits, risks ... results to be expected".
  - Annex I item 17 (always unfair): "Falsely claiming that a product is able to cure illnesses, dysfunction or malformations."
  - Art. 12: authorities may require the trader "to furnish evidence as to the accuracy of factual claims" and treat claims as inaccurate if it is not provided.
  - Art. 2(b): a "trader" is a person "acting for purposes relating to his trade, business, craft or profession".

  See [UCPD, CELEX 32005L0029](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32005L0029).

- **[BINDING] MDR Art. 7**: it is "prohibited to use text, names, trademarks, pictures and figurative or other signs" that mislead about a device's intended purpose. **Art. 2(12)**: promotional material defines intended purpose. See [MDR](https://eur-lex.europa.eu/eli/reg/2017/745/oj).
- **[GUIDANCE] FDA 2026 General Wellness**: labeling "including instructions for use, user-facing claims, promotional materials, and marketing communications" must not exceed the stated wellness intended use. See [FDA General Wellness (PDF)](https://www.fda.gov/media/90652/download).

### Inferences

**Recommended rule:** every user-facing string about outcomes must be either (a) a functional description ("log", "store", "chart", "import", "export", "remind you of the schedule you set"), or (b) a verbatim, attributed quote from a public authority. No outcome, efficacy, accuracy or disease claims in the README, landing page, app copy, store listings or social posts. A PR checklist item "copy reviewed against banned list" enforces it, and a CI grep can catch the obvious banned terms.

**Banned** (README, landing, app, store, social):

- "diagnose", "detect", "screen for", "prevent [disease]", "treat", "cure", "manage your [diabetes / hypertension / ...]", "early warning", "catch [disease] early"
- "clinical-grade", "medical-grade", "clinically validated/proven", "accurate as a doctor", "doctor-approved", "FDA-cleared/approved", "CE-marked" (unless true, which it is not)
- "abnormal", "at risk", "risk score", "your risk of [disease]", "biological age" presented as health status
- "AI doctor", "AI clinician", "medical advice", "personalised medical recommendations"
- "improves your health / longevity / adds years", "optimise your biomarkers", "reverse [condition]"
- "HIPAA-compliant" (not applicable, and misleading), "GDPR-certified" (no such general certification)
- Unqualified "secure", "private", "we never share your data" unless literally true and enforced. Under the FTC HBNR and GoodRx precedent, a privacy promise that is broken becomes an "unauthorized disclosure".

**Allowed:**

- "Keep your labs, body composition, workouts, nutrition, sleep and wearable data in one private record."
- "See trends and history over time." / "Import from Health Connect and other sources."
- "Self-hostable; your data stays on your server." Only for D1/D2 docs, and accurate only if no third-party calls are made by default.
- "Shows preventive-care guidance published by [authority], with a link to the source and the date it was last checked."
- "Optional AI assistant (off by default) that can summarise your own records. It is not medical advice and can be wrong."
- "General wellness and record-keeping. Not a medical device. Not medical advice."
- FDA-style lifestyle phrasing only when attributing an authority. For example, "[Authority] notes that regular physical activity may help reduce the risk of high blood pressure", linked to the source.

**Residual risk:** Free D3 without a "trade, business" purpose may fall outside UCPD "trader", but this cannot be relied on, because donations or future monetisation would change it. The banned-term list cannot catch implied claims in AI-generated text, so the AI coach output needs its own system-prompt guardrails and a refusal policy.

### Gaps

- The EU Nutrition and Health Claims Regulation (1924/2006) applies to food claims, not apps. It is not relevant unless OpenValens markets supplements (not researched).
- No national (Portuguese DGC or ERS) guidance on health-app advertising was searched.
- The 2024/825 "Empowering Consumers" amendments to the UCPD (applicable from 27 Sept 2026) were not checked for relevant new blacklist items.

---

## 5. Governance without a clinician: a defensible alternative to DCB0129/DTAC (#97)

### Takeaway

No source requires a named clinician for non-device wellness software. DCB0129/DTAC are NHS-England procurement and clinical-safety standards for health IT deployed in NHS settings, and they do not bind an EU individual's wellness app (inference; the standards were not re-fetched). Authorities that license recommendation content set source-fidelity conditions, not clinician conditions. The NHS syndication licence requires that adaptations "must not materially change the meaning" or mislead, and that warnings and disclaimers are kept. USPSTF offers an API that filters recommendations by age, sex and risk factors, with prior approval and weekly refresh. That is an authority-sanctioned version of exactly the feature planned. A maintainer-run fidelity process with provenance, expiry and "information from <authority>, not advice" framing is the defensible substitute.

### Cited Findings

- **[CONTRACT TERMS, via search summary – full PDF not retrieved]** The NHS Website Syndicated Content Standard Licence Terms (30 Nov 2022) require:
  - attribution to the NHS website with a visible logo linked to the source page;
  - adaptations "must not materially change the meaning of the underlying ... Syndicated Content, and must not be misleading to end users";
  - "All applicable warnings or disclaimers ... must be included".

  See [NHS Syndication Terms (PDF)](https://developer.api.nhs.uk/documents/NHS.UK%20Syndication%20Terms%2030-11-22.pdf) (now redirects to [NHS England developer hub](https://digital.nhs.uk/developer)), [NHS Website Content API v1](https://digital.nhs.uk/developer/api-catalogue/nhs-website-content/v1), and [NHS "content not licensed for re-use"](https://www.nhs.uk/our-policies/terms-and-conditions/content-not-licensed-for-re-use/).

- **[OFFICIAL API DOCS]** USPSTF Prevention TaskForce API "returns a filtered USPSTF recommendations data set according to keywords and specific patient characteristics, such as age, sex, selected behavioral risk factors, and recommendation grades". Access requires prior approval (email uspstfpda@ahrq.gov with a use overview) and a token. USPSTF suggests caching the full JSON and refreshing about weekly. See [USPSTF API page](https://www.uspreventiveservicestaskforce.org/apps/api.jsp) and [API instructions (PDF)](https://www.uspreventiveservicestaskforce.org/files/preventiontaskforce_data_api_wi.pdf).
- **[GUIDANCE]** The FDA 2026 wellness guidance itself treats "official statements made by healthcare professional organizations" as an adequate basis for lifestyle-disease association claims. Authority provenance is therefore the recognised evidence anchor, not in-house clinical review. See [FDA General Wellness (PDF)](https://www.fda.gov/media/90652/download).
- **[GUIDANCE]** MDCG 2019-11 rev.1 decision step 4 excludes "generic diagnostic or treatment pathways (not directed to individual patients), scientific literature". Faithful republication of authority guidance supports a non-device position. See [MDCG 2019-11 rev.1](https://health.ec.europa.eu/document/download/b45335c5-1679-4c71-a91c-fc7a4d37f12b_en?filename=mdcg_2019_11_en.pdf).

### Inferences

**Recommended decision.** Adopt a "Source-Fidelity Governance" policy in place of DCB0129-style clinical safety. Record it as an ADR, citing this note.

1. **Allowed sources only:** public authorities with machine-readable or licensed content. Examples: USPSTF (via approved API), CDC/ACIP schedules, NHS (under syndication terms, UK-focused), DGS Portugal (Programa Nacional de Vacinação and screening programmes), WHO, and ECDC. Record licence terms per source in a `sources` registry: URL, licence, retrieval date, version or hash.
2. **Verbatim display:** recommendation text, population and grade are shown exactly as published, with the authority's name, publication date, "last checked" date and a deep link. No paraphrase. If a summary is needed for UI, use the authority's own short title. Never merge or harmonise across authorities; show each authority separately when they differ.
3. **Deterministic filtering only:** match on the fields the authority itself uses (age band, sex, user-declared criteria quoted from the authority). Never use lab values or vitals. Filtering logic is unit-tested against fixtures from the authority's own data.
4. **Automated expiry:** each item carries `retrieved_at` and `review_by`, at most 90 days for API-backed sources or the authority's stated refresh cadence (USPSTF weekly). Expired items are hidden or marked "may be out of date – check source". A scheduled job diffs upstream content and blocks display of changed items until the maintainer re-approves.
5. **Maintainer fidelity review (two-step, logged):**
   - Step 1, ingestion diff: automated hash comparison.
   - Step 2, the maintainer confirms verbatim match, attribution and licence, recorded with timestamp in an audit table. This is a source-fidelity check, not a clinical judgment, so no clinician is needed.
6. **Framing on every item:** "Information from <Authority>, published <date>. This is general public-health guidance, not personal medical advice. It may not apply to you. Discuss with a healthcare professional." No urgency words ("overdue", "you need").
7. **Hazard log (lightweight, DCB0129-inspired but non-clinical):** a markdown or DB register of software hazards with a mitigation and test for each. Examples: wrong age calculation, stale guidance, wrong-sex match, timezone errors in reminders, AI hallucination. Review it at each release. This keeps the useful engineering part of DCB0129 without the clinical-safety-officer role.
8. **User feedback channel:** "Report a problem with this guidance" goes to the maintainer queue with an SLA. Errors pull the item within a defined window.
9. **AI coach:** it may only cite stored authority items and the user's own data. It must refuse diagnosis, treatment and risk interpretation. Keep an evaluation set of refusal prompts in CI.

**Residual risk:** Without a clinician, nobody independently checks whether an authority's guidance applies to a given user. The policy mitigates this by never asserting applicability; it attributes and links instead. Licence restrictions (NHS is UK-centric, USPSTF needs approval) may block some sources.

### Gaps

- The full NHS syndication licence PDF could not be retrieved (it redirects). Clause numbers, any UK-only territorial limit, commercial-use terms and refresh obligations are unverified. Fetch them via the NHS England developer hub before integrating.
- USPSTF API terms of use (attribution or alteration rules beyond the access process) were not retrieved.
- WHO content reuse policy (generally CC BY-NC-SA 3.0 IGO for publications) was not fetched. The non-commercial clause would matter for D3 if it is ever monetised.
- DGS (Portugal) and ECDC reuse terms were not researched.
- The DCB0129/DCB0160 and DTAC current texts were not fetched. The claim that they bind only NHS-deployed health IT is an inference.
- No guidance found that is addressed specifically to non-clinical publishers republishing public-health recommendations. The licence terms above are the closest primary analogue.
