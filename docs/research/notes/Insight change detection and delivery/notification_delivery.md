# Delivering Health Insights via Push Notifications and Email (openhealth)

Scope: evidence on push/email insight delivery for a general-wellness, adults-18+, non-diagnostic open-source health app. Statistical change-detection methods are out of scope (another researcher). Research conducted 2026-10-02. Evidence type and population are stated for each claim. Where a page could not be fetched directly, this is flagged.

## 1. Do push notifications/prompts change engagement and behavior? Do effects decay? What timing works?

### Takeaway
Micro-randomized trials (MRTs) consistently show that a notification produces a real but short-lived ("proximal") increase in app opening or activity, measured within minutes to 24 hours. The size of that increase varies a lot by app and outcome. For behavior (steps), the effect faded over weeks in HeartSteps. For app opening, the effect did not clearly fade in Drink Less (30 days) or JOOL (12 weeks). Notifications did not change long-term disengagement in the one MRT that measured it. Timing matters: weekends, mid-day, and moments when the user was recently sedentary did better.

### Cited Findings
- **HeartSteps I (Klasnja et al., 2019, Annals of Behavioral Medicine).** MRT, n=37 sedentary adults, 6 weeks, up to 5 randomizations per day, 60% chance of a suggestion at each one. Averaged over the study, a suggestion raised the 30-minute step count by 14% (35 steps over a 253-step average, p=.06). Early in the study the increase was 66% (167 steps, p<.01) and it "diminished over time." Walking suggestions: +24% overall (59 steps, p=.02), +107% (271 steps) at the start, then declining. Anti-sedentary suggestions had no detectable effect. Limitation: very small sample. — [Semantic Scholar record/abstract](https://www.semanticscholar.org/paper/Efficacy-of-Contextually-Tailored-Suggestions-for-A-Klasnja-Smith/a825886eeb254a96cd3ae44e2699aedfc606b774); [ResearchGate](https://www.researchgate.net/publication/327451781_Efficacy_of_Contextually_Tailored_Suggestions_for_Physical_Activity_A_Micro-randomized_Optimization_Trial_of_HeartSteps)
- **HeartSteps secondary analysis (functional data).** People responded to suggestions about 10 minutes after the push, and the response tapered off around 40 minutes. They responded more on weekdays and when recently sedentary. Evidence type: secondary methods paper (arXiv preprint) on the same n=37 data. — [arXiv 2410.15049](https://arxiv.org/html/2410.15049v1)
- **Bidargaddi et al., 2018 ("To Prompt or Not to Prompt?", JMIR mHealth uHealth 6(11):e10123, DOI 10.2196/10123).** MRT, n=1,255 users of the JOOL workplace well-being app (mostly office workers, 64% female), 89 days. Six decision points per day, 50% chance of a tailored push at each. Results:
  - Overall, engagement within 24 hours was 3.9% more likely when a push was sent.
  - Weekends: +8.7%. Weekdays: +2.5% (not significant).
  - Best slot was 12:30 pm on weekends (+11.8%).
  - No significant decay over 12 weeks (p=.84).
  - Limitations: a 24-hour outcome window, a workplace population, and the outcome was self-monitoring engagement, not health.
  — [PMC6293241](https://pmc.ncbi.nlm.nih.gov/articles/PMC6293241/); [PubMed 30497999](https://pubmed.ncbi.nlm.nih.gov/30497999/)
- **Bell et al., 2023 (Drink Less MRT, JMIR mHealth uHealth 2023;11:e38342).** n=350 new UK users aged 18+ with AUDIT ≥8, first 30 days. Each day at 8 pm users had a 30% chance of the standard message, 30% chance of a new message, or 40% chance of nothing. Results:
  - A notification raised the probability of opening the app in the next hour 3.5-fold (95% CI 2.91–4.25).
  - New and standard messages were similarly effective.
  - The effect did not change significantly over time.
  - Time to disengagement did not differ between the standard-notification arm, the no-notification arm, and the MRT arm.
  - Limitation: the specific numbers come from search snippets of the abstract. A direct fetch of the full text failed.
  — [JMIR](https://mhealth.jmir.org/2023/1/e38342); [PMC10337295](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10337295/); [LSHTM PDF](https://researchonline.lshtm.ac.uk/id/eprint/4670198/1/Bell-etal-2023-How-notifications-affect-engagement-with.pdf)
- **Nahum-Shani et al., 2018 (JITAI framework, Annals of Behavioral Medicine 52(6):446–462).** Conceptual/design paper, not empirical. It defines JITAIs as delivering support at "states of vulnerability/opportunity" and when the person is receptive. This is the basis for using decision points, tailoring variables, and the option of sending nothing. — [Search summary / Harvard JITAI page](http://people.seas.harvard.edu/~samurphy/JITAI_MRT/jitai.html)

### Inferences
- An insight push can reliably bring a user back into the app. The evidence that it changes health behavior beyond that short window is weak and inconsistent, and the behavioral effect in HeartSteps decayed over weeks.
- "Not sending" should be a first-class outcome of the delivery policy. Every MRT here treats not sending as the comparison arm, and the JITAI framework treats it as a valid intervention option.
- For non-urgent wellness insights, mid-day and weekend delivery has the best (modest) evidence. This is from a single workplace population and should not be over-generalized.
- Decay evidence is mixed. It is stronger for behavior outcomes (HeartSteps) than for app-open outcomes (JOOL, Drink Less). Novelty (new versus repeated message text) did not matter in Drink Less.

### Gaps
- No MRT found that tests notifications carrying personal data insights (for example "your resting HR rose"), as opposed to generic suggestions or reminders.
- Studies are all short (6 to 13 weeks). There is no evidence on whether effects last over months or years, which is what a longitudinal app needs.
- I did not verify a HeartSteps V2/V3 publication on decay.

## 2. Notification frequency, alert fatigue, opt-out and uninstall drivers

### Takeaway
Direct experimental evidence on the right frequency for health apps is scarce and underpowered. The one small three-arm trial found that more frequent or "intelligent" timing gave more views but no more usage, and the intelligent arm had higher discontinuation. Users already receive many notifications a day, and the volume is linked to negative affect. Survey and review evidence lists "too many notifications" as one uninstall driver among several, but most of that data is low quality or industry-sourced.

### Cited Findings
- **Morrison et al., 2017 (PLOS ONE, DOI 10.1371/journal.pone.0169162).** Exploratory RCT of a stress-management app with UK workplace employees. 202 downloaded it and 77 provided usable data.
  - Three arms: sensor-driven "intelligent" timing (n=25), daily (n=19), and occasional, about every 72 hours (n=33).
  - The intelligent and daily arms viewed and acted on more notifications than the occasional arm (d≈0.47–0.50). There was "no meaningful effect" on the percentage viewed or on app usage.
  - 53% stopped within 2 weeks. Discontinuation was 60% (intelligent), 42% (daily), and 39% (occasional).
  - Qualitative reports mentioned frustration with "perceived repetitiveness."
  - Limitations: underpowered, short.
  — [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0169162)
- **Pielot, Church & de Oliveira, 2014 (MobileHCI).** In-situ study, n=15 users, one week. Participants received 63.5 notifications per day on average and viewed them within minutes. More notifications were associated with more negative emotions, though social messages also increased feelings of connectedness. — [Paper PDF](https://scispace.com/pdf/an-in-situ-study-of-mobile-phone-notifications-37xljon7zn.pdf); [Semantic Scholar](https://www.semanticscholar.org/paper/An-in-situ-study-of-mobile-phone-notifications-Pielot-Church/39923a1c1e1354b8a3eae078faf2558f5b574157)
- **Uninstall drivers (low-quality evidence).** A CleverTap industry survey reported that 28% uninstalled apps because of too many ads and notifications. This is industry marketing data with unclear methods. — [CleverTap](https://clevertap.com/blog/uninstall-apps/)
- **mHealth abandonment.** A cross-sectional survey found the main drivers of mHealth abandonment were amotivation, loss of interest, and trying other apps. In that summary, notifications were not the main driver. — [PMC8872344](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8872344/)
- **mHealth app review mining.** A large-scale analysis of user reviews describes notifications as a "double-edged sword": helpful when "useful, timely, personalised and relevant," irritating otherwise. Evidence type: observational analysis of app-store reviews. — [Springer, Empirical Software Engineering](https://link.springer.com/article/10.1007/s10664-022-10222-6)
- **Mixed evidence on frequency.** In Drink Less, daily notifications did not speed disengagement compared with no notifications (see Section 1). — [PMC10337295](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10337295/)

### Inferences
- The evidence does not support any specific "optimal" number of notifications per day. A conservative default (at most about one insight push per day, with a digest for everything else) is defensible on burden grounds, and the Drink Less data suggest one a day is not by itself harmful.
- Sensor-driven "smart" timing has not been shown to beat fixed timing. Morrison found a higher dropout trend, and Bell et al. note that adaptive timing "does not always enhance" use. A simple fixed, user-chosen window is a reasonable first version.
- Track opt-out, mute, and disable rates for each notification category as the main signal of alert fatigue.

### Gaps
- No RCT found that compares frequencies of insight or alert notifications against opt-out or uninstall outcomes in a wellness population.
- The JMIR 2024 scoping review "When and Why Adults Abandon Lifestyle Behavior and Mental Health Mobile Apps" ([link](https://www.jmir.org/2024/1/e56897)) could not be fetched, so its findings on notifications are not recorded.

## 3. Content framing: descriptive feedback vs prescriptive advice; gain vs loss framing; self-monitoring feedback

### Takeaway
Feedback on behavior and outcomes is a recognized behavior change technique, and a large meta-analysis shows that interventions which increase progress monitoring improve goal attainment (d≈0.40). For prevention behaviors (such as physical activity), gain-framed messages slightly outperform loss-framed ones (r≈0.08). I found no direct trial comparing descriptive and prescriptive insight notifications.

### Cited Findings
- **Michie et al. BCT Taxonomy v1 (2013).** 2.2 "Feedback on behaviour": "Monitor and provide informative or evaluative feedback on performance of the behaviour" (for example, steps per day). 2.7 "Feedback on outcome(s) of behaviour" (for example, weight lost). Evidence type: consensus taxonomy, not an effect estimate. — [BCTTv1 PDF (SBM)](https://www.sbm.org/UserFiles/file/Michie-etal2013BCTV193techniquesAddlFileTaxonomy.pdf); [Annals of Behavioral Medicine paper (City repository)](https://openaccess.city.ac.uk/id/eprint/3293/1/Michie%20et%20al%20Annals%20of%20Behavioral%20Medicine%202013%20-%20BCT%20Taxonomy%20v1.pdf)
- **Harkin et al., 2016 (Psychological Bulletin 142(2):198–229).** Meta-analysis of 138 RCTs (N=19,951) of interventions to promote monitoring of goal progress.
  - Interventions increased monitoring frequency (d+=1.98, 95% CI 1.71–2.24) and goal attainment (d+=0.40, 95% CI 0.32–0.48).
  - The increase in monitoring mediated the gain in goal attainment.
  - Effects were larger when progress was reported or made public, and when it was physically recorded.
  - Population: mixed health and non-health goals.
  — [White Rose eprint](https://eprints.whiterose.ac.uk/id/eprint/87431/); [Ovid](https://www.ovid.com/journals/plbul/fulltext/10.1037/bul0000025~does-monitoring-goal-progress-promote-goal-attainment-a)
- **Gallagher & Updegraff, 2012 (Annals of Behavioral Medicine 43:101–116).** Meta-analysis of about 94 studies.
  - For prevention behaviors, gain-framed messages beat loss-framed ones on behavior (r=0.083, p=.002), especially for physical activity, smoking cessation, and skin cancer prevention.
  - There was no framing effect on attitudes or intentions, and none for detection behaviors.
  - Effects were small and variable.
  — [Semantic Scholar](https://www.semanticscholar.org/paper/Health-Message-Framing-Effects-on-Attitudes,-and-A-Gallagher-Updegraff/89fb73ce6ebdda6af939c6832bd96057058d7d07); [ResearchGate](https://www.researchgate.net/publication/51714173_Health_Message_Framing_Effects_on_Attitudes_Intentions_and_Behavior_A_Meta-analytic_Review)
- **Message novelty.** In Drink Less, new and standard (repeated) message text were similarly effective for app opening. — [PMC10337295](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10337295/)

### Inferences
- Insight notifications that state what changed in the user's own data are a form of BCT 2.2/2.7 feedback. This supports neutral, descriptive "here is what changed" content as the core, with optional gain-framed suggestions. That also fits openhealth's no-diagnosis, deterministic-summary posture.
- Avoid loss-framed or alarm framing for wellness insights. There is no behavioral benefit for prevention behaviors, and it raises the risk of anxiety and of implying a diagnosis (an inference, not directly tested).
- Harkin's moderator ("physically recorded") suggests insights should link to a persistent, reviewable record in the app rather than being ephemeral.

### Gaps
- No RCT found that compares descriptive and prescriptive wording in health-data insight notifications.
- No evidence found on the anxiety or "worried-well" effects of change alerts in consumer wearables, such as alerts for HRV or resting HR changes.

## 4. Email digests / weekly summaries

### Takeaway
Evidence for weekly email summaries in self-tracking is thin. The best RCT found was small (n=47) and showed only within-group improvement, with no significant difference between groups. Weekly email is a reasonable low-burden channel, but its efficacy is unproven.

### Cited Findings
- **Black & Brunet, 2021 (JMIR mHealth uHealth, DOI 10.2196/28128).** RCT, n=47 Canadian women with BMI ≥25, mean age 37.6.
  - Arms: tracker + guidelines + 6 weekly SDT-based behavioral support emails (n=15), tracker + guidelines (n=16), guidelines only (n=16).
  - The email group alone had a significant within-group increase in self-reported walking (χ²=7.5, p=.02). Between-group differences were not significant, and no group improved in MVPA.
  - The email group improved in perceived competence and relatedness.
  - Limitations: small sample, self-reported physical activity, no email engagement data.
  - Note: these emails were coaching content, not data digests.
  — [PMC8729328](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8729328/)

### Inferences
- A weekly digest maps to BCT 2.2/2.7 feedback and to Harkin's monitoring mechanism, so it has theoretical support. Direct trial evidence for automated personal-data digests is lacking.
- A digest is a natural way to batch lower-priority insights and reduce push volume.

### Gaps
- No RCT found specifically on automated weekly data-summary emails (as in Fitbit or Oura-style reports) and their effect on engagement or behavior.
- No evidence found on the best digest day or time.

## 5. Privacy of notification and email content

### Takeaway
Both mobile platforms let the app control what shows on the lock screen. Android's VISIBILITY_PRIVATE/SECRET plus a redacted public version is the documented pattern, though users keep the final say. Apple's App Review Guidelines say push notifications should not carry sensitive personal or confidential information. Under HIPAA-style norms, unencrypted email of health information is acceptable only with risk disclosure and user preference. Under UK PECR/GDPR, purely service messages are not marketing, but adding promotion makes them marketing.

### Cited Findings
- **Android lock-screen visibility.** Android developer docs define three levels:
  - VISIBILITY_PUBLIC: full content shows.
  - VISIBILITY_SECRET: nothing shows.
  - VISIBILITY_PRIVATE: only basic information, such as the icon and content title, shows.
  - With PRIVATE you can attach a redacted alternative through setPublicVersion(). Example: "You have 3 new text messages" while hiding contents and senders.
  - "The user always has ultimate control over whether their notifications are visible on the lock screen."
  — [Android Developers: Create a notification](https://developer.android.com/develop/ui/views/notifications/build-notification)
- **Android 13+ opt-in.** Since Android 13 (API 33), apps must request the POST_NOTIFICATIONS runtime permission, so notifications are opt-in on Android too. Older search snippets saying Android "subscribes users by default" are out of date. — [Android Developers: Notification runtime permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission); [AOSP](https://source.android.com/docs/core/display/notification-perm)
- **Apple App Review Guideline 4.5.4.** Push notifications must not be required for the app to work, "should not be used to send sensitive personal or confidential information," and must not be used for promotions or direct marketing unless users explicitly opt in through consent language in the app UI, with an in-app way to opt out. — [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/); [history of the 2020 change](https://www.appstorereviewguidelineshistory.com/articles/2020-03-04-push-notifications-marketing-and-more/)
- **Apple interruption levels (iOS 15+).** There are four levels:
  - Passive: delivered silently to the list.
  - Active: the default.
  - Time Sensitive: can break through Focus and scheduled summary.
  - Critical: needs a special entitlement.
  — [WWDC21 session 10091](https://developer.apple.com/videos/play/wwdc2021/10091/)
- **Apple HIG.** The Notifications page could not be fetched (it renders client-side), so its exact wording is not recorded. — [HIG Notifications](https://developer.apple.com/design/human-interface-guidelines/notifications)
- **HIPAA and email.** HHS guidance allows covered entities to email patients. If an individual prefers unencrypted email after being warned of the risk, the entity may honor that and is not responsible for a breach in transit. The warning should say that unencrypted email may be intercepted or sent to the wrong address. Caveat: the HHS FAQ page returned 403 to a direct fetch, so this rests on secondary summaries. — [HHS FAQ 570 (not directly fetched)](https://www.hhs.gov/hipaa/for-professionals/faq/570/does-hipaa-permit-health-care-providers-to-communicate-with-patients-by-e-mail/index.html); [secondary summary](https://www.chartrequest.com/articles/hipaa-emailing-medical-records)
- **UK ICO (PECR).**
  - Direct marketing is "the communication (by whatever means) of advertising or marketing material which is directed to particular individuals," including promotion of aims and ideals.
  - Service messages (administrative or customer-service content, such as reminders or terms updates) are not direct marketing.
  - Adding promotional material turns a service message into marketing.
  — [ICO: Identify direct marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/direct-marketing-guidance/identify-direct-marketing/); [ICO: key concepts for email marketing](https://ico.org.uk/for-organisations/direct-marketing-and-privacy-and-electronic-communications/guidance-on-direct-marketing-using-electronic-mail/key-concepts-for-direct-marketing-using-electronic-mail/)
- **GDPR Article 9.** Health data is special category data. Where consent is the legal basis, it must be explicit, and it must be freely given, specific, informed, unambiguous, and withdrawable. Source quality: secondary (vendor blog plus ICO). — [ICO: when is consent appropriate](https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/lawful-basis/consent/when-is-consent-appropriate/); [Momentum blog (secondary)](https://www.themomentum.ai/blog/gdpr-consent-requirements-health-data)
  - Unverified: a claim on the Momentum blog that "over 80% of health apps rely on consent per a 2023 EDPB analysis" could not be traced to an EDPB source. Treat it as unverified.

### Inferences
- Default insight pushes to generic, non-revealing text, for example "You have a new weekly insight" rather than "Your resting heart rate rose 8 bpm." On Android, use VISIBILITY_PRIVATE with a redacted setPublicVersion. On iOS, use non-sensitive alert text, since Apple's 4.5.4 discourages sensitive data in pushes, and default to Passive interruption level for non-urgent insights.
- Email digests should by default contain no or minimal health values and link to the authenticated app, unless the user explicitly opts in to detailed email content after a risk disclosure (mirroring the HIPAA "warn and honor preference" pattern even where HIPAA does not apply).
- Keep insight and digest messages purely service and feedback content. Including product promotion (for example "upgrade," or other features) would bring them under marketing consent rules in the UK/EU and under Apple 4.5.4 opt-in requirements.
- Insight pushes are derived health data. Under GDPR, sending them is processing of special category data, so the Article 9 basis (usually explicit consent) must cover this processing and the use of third-party push and email processors (APNs, FCM, an email provider).

### Gaps
- Whether HIPAA applies to openhealth depends on its covered-entity or business-associate status. A self-hosted consumer wellness app is likely outside HIPAA, but the US FTC Health Breach Notification Rule (amended 2024) may apply to non-HIPAA health apps. This was not verified in this research and needs a separate check.
- No EDPB guideline found that specifically addresses the content of health push notifications or emails.
- I did not find whether the EU ePrivacy Directive treats in-app push notifications as "electronic mail" for marketing purposes, or how the push equivalent of the ICO service/marketing split works.
- No empirical study found on how often lock-screen health notifications are actually exposed (shoulder-surfing) or how users perceive that.

## 6. Consent defaults: opt-in vs opt-out for health notifications; ethics of nudging

### Takeaway
Defaults are powerful (meta-analytic d≈0.68), and opt-out designs raise participation in health contexts. That power is exactly why default settings for health insight notifications carry ethical weight. Both OS platforms now require an explicit permission grant for notifications, and GDPR requires explicit consent for special-category processing. Within the app, that points to opt-in, or at least clearly disclosed and easily reversible, defaults for each insight category.

### Cited Findings
- **Jachimowicz et al., 2019 (Behavioural Public Policy 3(2):159–186, DOI 10.1017/bpp.2018.43).** Meta-analysis of default effects: d=0.68 (95% CI 0.53–0.83). Defaults were stronger in consumer domains and when they signal endorsement (what the choice architect recommends) or endowment (the status quo). — [Columbia Business School](https://business.columbia.edu/faculty/research/when-and-why-defaults-influence-decisions-meta-analysis-default-effects); [RePEc](https://ideas.repec.org/a/cup/bpubpo/v3y2019i02p159-186_00.html)
- **Opt-in vs opt-out for secondary use of health data (RCT).** Opt-out produced higher consent rates and less bias than opt-in. This concerns data reuse, not notifications. — [ScienceDirect](https://www.sciencedirect.com/science/article/pii/S0953620525000275)
- **COVID SAFE RCT.** Tested opt-in vs opt-out framing for enrollment in surveillance testing. The result was not extracted in detail here. — [PMC8176333](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8176333/)
- **Platform rules.** Android 13+ and iOS both require an explicit user grant before any notifications. Apple additionally requires explicit opt-in for promotional pushes. — [Android notification permission](https://developer.android.com/develop/ui/compose/notifications/notification-permission); [Apple App Review Guidelines 4.5.4](https://developer.apple.com/app-store/review/guidelines/)
- **Engagement claim.** An industry claim that "users who opt in are 4x more engaged" appeared in search results, but its source is a vendor and it is confounded by self-selection. It should not be used as evidence. — (no reliable source; recorded as a caution)

### Inferences
- Because the OS permission is already opt-in, the real design choice is the in-app default for each insight category once permission is granted. An ethical default is to enable only low-burden, service-type messages, such as a weekly digest or reminders the user set up. Unsolicited "change detected" insight pushes would then be opt-in, with an explanation of what they contain and how to turn them off.
- Defaults signal endorsement (Jachimowicz). Turning health-change alerts on by default implicitly tells users the app thinks they should watch these signals, which matters for a non-diagnostic wellness app.
- Pre-permission explanation screens are common practice for asking at the right moment rather than at first launch (an inference; no RCT found).

### Gaps
- No RCT found comparing opt-in and opt-out defaults specifically for health app notification categories.
- No peer-reviewed paper on the ethics of nudging via health app notifications was retrieved in this pass. The literature exists (digital nudging and autonomy) but was not verified here.
