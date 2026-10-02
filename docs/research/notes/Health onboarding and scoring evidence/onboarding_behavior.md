# Health-app onboarding, goals, and sustained engagement

## Onboarding burden and user control

### Takeaway

There is little robust experimental evidence specifying an ideal onboarding sequence or survey length for general-purpose health apps. The strongest directly relevant recent comparison suggests human assistance can improve initial adoption in a chronic-pain context, but did not establish better sustained engagement; this does not prove onboarding can be skipped or prescribe a step count.

### Cited Findings

- In a prospective, nonrandomized 4-week study of 48 adults with chronic musculoskeletal pain, assisted in-person setup increased downloads (15/15 vs 10/16 standard email and 13/17 video; P=.009), but differences in log-ins were not significant (P=.18); adherence was low (27%) and 46% remained using at week 4. Study describes assisted onboarding as 30 minutes. Full text/abstract available at [JMIR 2026](https://mhealth.jmir.org/2026/1/e78827); PMID [41911021](https://europepmc.org/article/med/41911021). **Caution:** small, nonrandomized, clinical and supported-use context, not a consumer self-serve web/mobile onboarding trial; support included study reminders. Its findings separate initial adoption from sustained engagement.
- User-centered accessibility matters through the whole flow: a scoping review of 25 studies found barriers across perceivability, operability, navigation, input modalities, and understandability, and recommends universal design and participatory involvement of people with impairments. [Janssen et al., 2021, JMIR Rehabilitation and Assistive Technologies](https://pmc.ncbi.nlm.nih.gov/articles/PMC8754328/) (full text). **Caution:** broad digital-health scoping synthesis; not a trial of onboarding completion or skip controls.
- A scoping review of eHealth accessibility found 15 publications covering 12 services; formal accessibility definitions and WCAG use were uncommon. [Development and Evaluation of eHealth Services Regarding Accessibility](https://pmc.ncbi.nlm.nih.gov/articles/PMC10472171/) (2023; full text). The evidence supports testing accessibility, not assuming compliance or a particular progressive-disclosure pattern guarantees it.

### Inferences

- A skippable flow, clear “not now” choices, save/resume, and gradual optional setup are reasonable low-risk UX hypotheses to reduce forced burden, but direct clinical-app RCT evidence for those specific choices is sparse. Measure completion, abandonment, and later optional completion rather than asserting a scientifically optimal number of prompts.
- Accessibility is a constraint on both web and mobile flows, not an optional enhancement. Keyboard and screen-reader operability, plain language, adequate targets, flexible pacing, and user testing should be evaluated directly.

### Gaps

- No verified high-quality evidence establishing an optimal count or duration of onboarding screens, or showing that skippability itself improves retention or outcomes in a general self-tracking app.
- No evidence specific to free/open-source self-hosted apps; privacy, device support, and user capabilities may differ materially from study apps.

## Personal goals, baseline, and self-monitoring

### Takeaway

Goal-setting, self-monitoring, and feedback recur as plausible engagement supports, but the evidence does not justify treating an algorithmically personalized goal as universally superior to a generic or user-chosen goal. A directly relevant RCT found a selective benefit for personalized frequency targets, while overall engagement declined in both arms.

### Cited Findings

- Nuijten et al., “Evaluating the Impact of Adaptive Personalized Goal Setting on Engagement Levels of Government Staff With a Gamified mHealth Tool,” 2-month randomized trial, 176 staff from seven Belgian governmental organizations. App use and registered activities declined over time in both arms. Having set a goal was associated with more engagement; personalization produced a selective increase in sports-session frequency (reported P=.05) and personalized ride-duration goals affected perceived biking performance, but there was no general engagement advantage. [Full text, JMIR mHealth and uHealth 2022](https://pmc.ncbi.nlm.nih.gov/articles/PMC9015741/); DOI [10.2196/28801](https://doi.org/10.2196/28801); PMID [35357323](https://pubmed.ncbi.nlm.nih.gov/35357323/). **Limitations:** one workplace gamified campaign, 8 weeks, attrition and limited survey completion; outcomes do not establish long-term health benefit or generalize to all domains/users.
- Grady et al., systematic review and meta-analysis of 54 RCTs of engagement strategies in nutrition, physical activity, and weight-related digital interventions. Pooled strategies had small-to-moderate effects on use (SMD 0.33, 95% CI 0.20–0.46) and user experience (SMD 0.29, 95% CI 0.07–0.52), both rated **very-low-certainty**; strategy-specific analyses suggested social support and knowledge shaping associations with use. [Full text, JMIR 2023](https://pmc.ncbi.nlm.nih.gov/articles/PMC10762625/); DOI [10.2196/47987](https://doi.org/10.2196/47987); PMID [38113062](https://pubmed.ncbi.nlm.nih.gov/38113062/). **Limitations:** heterogeneous strategies and contexts; certainty is explicitly very low, and pooled effects do not establish a winning onboarding or scoring design.
- A systematic review of 28 studies found goal setting, self-monitoring, feedback, prompts/cues, rewards, and social support repeatedly associated with engagement; authors stress operationalization/context differences and gaps in causal evidence. [Potential associations between behavior change techniques and engagement with mobile health apps](https://pmc.ncbi.nlm.nih.gov/articles/PMC10545861/) (2023; full text). This is association-focused evidence, not proof that any one feature causes retention.
- Lee et al. studied self-monitoring and long-term engagement using a Korean commercial mHealth platform; cited by the scoping review as an observational primary study. [PLoS ONE 2018; DOI 10.1371/journal.pone.0201166](https://doi.org/10.1371/journal.pone.0201166). **Caution:** commercial-platform observational results are vulnerable to self-selection and are not evidence that manual entry is equivalent to passive tracking.

### Inferences

- For scores/insights, showing a personal trend against a user-understood baseline and explicitly chosen goal is a defensible product hypothesis: it makes feedback personally relevant and supports agency. It is not established that this is more clinically valid or engaging than all alternatives.
- Let users accept, edit, defer, or decline suggested goals; present the basis and uncertainty of suggestions. Avoid penalizing users for no baseline or sparse data. These are autonomy- and trust-preserving design principles, not effect sizes established by the cited trials.
- Manual tracking should remain an available path if the product intends to serve users without compatible sensors; the literature identifies manual entry as burdensome and users often prefer automated tracking, but that preference is not universal and does not validate excluding manual users.

### Gaps

- Little direct comparative evidence on scores tied to a user-selected goal versus population norms for a general wellness app; no evidence here validates a composite “readiness” score or a separation between daily readiness and longer-term progress.
- Studies rarely compare passive versus manual tracking while controlling for user preference, data completeness, and outcomes.

## Sustained engagement, notifications, and outcome interpretation

### Takeaway

Engagement generally declines over time, and app-use metrics are not health outcomes. Feedback, tailored content, self-monitoring, and reminders are promising but context-dependent; notification intensity or an assumed optimal cadence cannot be inferred from the available evidence.

### Cited Findings

- A 2022 systematic literature review of 62 adult mHealth studies found retention strategies included feedback, appropriate reminders, and peer/coach support; obstacles included technical problems, weak support, and low perceived usefulness. Its pooled regression associated clinical-condition status and compensation with retention, but research compensation is not a suitable product-design conclusion. [Xu et al., JMIR 2022](https://www.jmir.org/2022/4/e35120); DOI [10.2196/35120](https://doi.org/10.2196/35120). **Limitations:** narrative synthesis across heterogeneous research interventions; reminders were not isolated consistently, and retention definition was study completion.
- A systematic review of 35 studies identified personalization, reinforcement, communication, navigation, credibility, message presentation, and aesthetics as engagement themes; it explicitly called for more robust quantitative work. [Liu et al., JMIR 2020](https://www.jmir.org/2020/12/e21687); DOI [10.2196/21687](https://doi.org/10.2196/21687). Much evidence was qualitative/mixed-methods and does not establish causal superiority.
- A systematic review of 292 mHealth studies found over 60 different engagement terms and 11 measurement approaches; among studies reporting engagement over time, 77% reported decline. Only 19.2% treated engagement as a research endpoint. Authors emphasize burden and the distinction between app use (“Little e”) and behavior/health outcomes (“Big E”). [JMIR 2024 systematic review](https://pmc.ncbi.nlm.nih.gov/articles/PMC11462107/) (full text). **Limitations:** chronic-condition interventions, highly heterogeneous measures; reported use is not proof of benefit.
- In Nuijten et al.’s RCT above, use declined over the eight-week campaign regardless of assignment. This is an app-specific primary-study observation, not an inevitable universal law.

### Inferences

- Make notifications user-controlled (opt-in, timing/frequency controls, pause/quiet periods) and test them; “appropriate reminders” is not equivalent to “more reminders.” Track opt-outs and notification fatigue as well as return use.
- Define separate metrics for initial adoption, meaningful feature use, retention, and health/behavior outcomes. Avoid declaring a scoring feature successful from logins alone.

### Gaps

- The sources located do not establish an optimal notification schedule or a causal notification-fatigue threshold for general wellness apps.
- Long-term retention evidence beyond intervention/research settings is limited; decreased use can reflect burden, loss of relevance, or reduced need, and is not interpretable without context.

## Discussion decisions: what science can and cannot settle

1. **#98: Make onboarding skippable or mandatory?** Evidence supports reducing avoidable entry friction and providing assistance where useful, but does not settle skippability’s effect. Prefer optional, reversible setup with core value available immediately; test adoption and later completion rather than claiming proven retention gains.
2. **Progressive onboarding?** Treat progressive disclosure as a usability/accessibility hypothesis, not a validated universal recipe. Keep essential orientation concise, defer optional domains, preserve progress, and test across web/mobile and assistive technologies.
3. **#92/#95: personalized versus generic targets?** RCT evidence is mixed/selective. Offer user-set goals and transparently suggested targets, with editable/deferred choices; do not assert adaptive personalization is always better.
4. **Use personal baseline and chosen goals?** Reasonable for relevance and autonomy, but the literature does not validate particular readiness/progress composites or show personal-baseline scoring improves clinical outcomes. Explain source, timeframe, missingness, and comparison in the UI.
5. **Manual users and incremental domains?** Keep manual capture when feasible and let people add domains as needed; recognize the input burden and test it. Evidence neither proves manual entry is equivalent nor supports sensor-only exclusion.
6. **Readiness vs progress and notifications?** The distinction is a product preference, not a scientific conclusion. Evaluate whether users understand separate time horizons; make prompts configurable and measure meaningful use and outcomes, not engagement proxies alone.

## Citation and evidence cautions

- The 2026 onboarding paper is a small nonrandomized study in chronic pain with a supported clinical research workflow; it cannot establish an optimal consumer onboarding flow.
- Grady et al.’s meta-analysis has **very-low-certainty** pooled estimates; avoid describing SMDs as robust guaranteed app effects.
- Nuijten et al. is a true RCT, but its positive personalization result is domain/task-specific and borderline for sports-session frequency; avoid general claims that personalized goals beat generic goals.
- Search surfaced a 2026 paper on “step goal personalization strategies” but it was not independently verified here; do not cite pending primary-source validation.
