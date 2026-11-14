/**
 * Issue #298 — what every oRPC procedure may do when an OpenValens Cloud
 * workspace's access has ended (trial or plan over, or a payment overdue past
 * the grace period). Self-host never consults this: it always has full access.
 *
 * | Class    | Ended (read-only) workspace                                        |
 * |----------|--------------------------------------------------------------------|
 * | `read`   | allowed: reading records never depends on the plan                 |
 * | `always` | allowed: data rights (export, deletion), consent withdrawal and    |
 * |          | removing access, billing, sign-in, and the access state itself    |
 * | `write`  | refused with `ACCESS_READ_ONLY`                                    |
 * | `ai`     | refused with `ACCESS_READ_ONLY` (the AI coach and AI drafting are  |
 * |          | part of the plan), even when the call writes nothing              |
 *
 * **Default deny.** A procedure missing from this map is treated as `write`,
 * so a new mutation can never slip through on an ended workspace. The test
 * `access-policy.test.ts` walks the whole router and fails when a procedure is
 * missing here or listed but gone, so every new procedure gets an explicit,
 * reviewed class. When in doubt, choose `write`.
 *
 * Deleting single records is `write`: deleting the whole account
 * (`dataRights.deleteEverything`) and turning a module off with its data
 * (`cycle.turnOffAndErase`) stay available, as do exports in every format.
 */

export const PROCEDURE_ACCESS_CLASSES = ["read", "write", "ai", "always"] as const;
export type ProcedureAccessClass = (typeof PROCEDURE_ACCESS_CLASSES)[number];

const R = "read" as const;
const W = "write" as const;
const AI = "ai" as const;
const ALWAYS = "always" as const;

/** Keyed by the procedure path joined with dots, as oRPC routes it (`plans.workouts.getWorkout`). */
export const PROCEDURE_ACCESS: Readonly<Record<string, ProcedureAccessClass>> = Object.freeze({
  // The access state itself: the apps read it to show the notice and pause sync.
  "access.status": ALWAYS,

  "about.info": R,

  "activity.dailyTotals": R,
  "activity.weeklyLoad": R,

  // Instance administration is the operator's, not a workspace's plan.
  "adminSettings.access": ALWAYS,
  "adminSettings.configuration": ALWAYS,
  "adminSettings.backupStatus": ALWAYS,
  "adminSettings.productSettings": ALWAYS,
  "adminSettings.updateProductSettings": ALWAYS,
  "adminSettings.aiUsage": ALWAYS,
  "adminSettings.onboardingTotals": ALWAYS,

  // Self-host admission (invitations to the instance), public or operator-only.
  "admission.status": ALWAYS,
  "admission.begin": ALWAYS,
  "admission.complete": ALWAYS,
  "admission.issueInvitation": ALWAYS,
  "admission.revokeInvitation": ALWAYS,
  "admission.listInvitations": ALWAYS,

  "ai.chat": AI,
  "ai.listThreads": R,
  "ai.listMessages": R,
  "ai.extract": AI,
  "ai.generateInsight": AI,
  "ai.workspaceConsent.get": R,
  // A toggle that can withdraw consent: never blocked.
  "ai.workspaceConsent.set": ALWAYS,
  "ai.consent.get": R,
  "ai.consent.grant": W,
  "ai.consent.revoke": ALWAYS,

  // Connected AI apps (#439). Existing grants keep reading on an ended
  // workspace (MCP and REST reads are never blocked); a new key is a write.
  // Revoking and the owner's off switch remove access: never blocked.
  "aiApps.status": R,
  "aiApps.listGrants": R,
  "aiApps.recentActivity": R,
  "aiApps.createKey": W,
  "aiApps.revokeGrant": ALWAYS,
  // Deleting what an AI app wrote is the member's control over their own
  // records (#439, M2), like revoking: allowed while read-only.
  "aiApps.deleteWrites": ALWAYS,
  // Drafts an AI app wrote (M2c): confirming one saves records, so it is a
  // write; discarding one saves nothing and is the member's control.
  "aiApps.drafts.list": R,
  "aiApps.drafts.confirm": W,
  "aiApps.drafts.discard": ALWAYS,
  "aiApps.workspaceSetting.get": R,
  "aiApps.workspaceSetting.set": ALWAYS,
  // OAuth consent screen (M1b): approving a connection creates a grant, like a
  // new key; denying it changes nothing.
  "aiApps.oauth.describe": R,
  "aiApps.oauth.approve": W,
  "aiApps.oauth.deny": ALWAYS,

  "analytics.getPreference": R,
  // Opting out of analytics is consent withdrawal; capture is product telemetry, not a record.
  "analytics.setPreference": ALWAYS,
  "analytics.capture": ALWAYS,

  // Plan & billing: the way back to full access.
  "billing.status": ALWAYS,
  "billing.checkout": ALWAYS,
  "billing.portal": ALWAYS,

  "preferences.get": R,
  // The interface language (exports and emails use it too).
  "preferences.setLocale": ALWAYS,

  "body.listCheckins": R,
  "body.dailyWeights": R,
  "body.weightTrend": R,
  "body.writeManualWeight": W,
  "body.ingestAutoWeightEvent": W,
  "body.listWeightHistory": R,
  "body.listDexaScans": R,
  "body.getLatestDexa": R,
  "body.listDexaRegionals": R,
  "body.getLatestWeight": R,
  "body.getLatestCanonicalWeight": R,
  "body.getBodyCompositionTimeline": R,

  "clinical.listBloodPanels": R,
  "clinical.getBloodPanel": R,
  "clinical.listCardiacExams": R,
  "clinical.getCardiacExam": R,
  "clinical.listImagingStudies": R,
  "clinical.getImagingStudy": R,
  "clinical.listConsultations": R,
  "clinical.getConsultation": R,
  "clinical.listFamilyHistory": R,
  "clinical.upsertFamilyHistoryEntry": W,
  "clinical.deleteFamilyHistoryEntry": W,

  "coach.getConfig": R,
  "coach.upsertConfig": W,
  "coach.listTemplates": R,
  "coach.upsertTemplate": W,
  "coach.computeInstruction": R,
  "coach.recordFeedback": W,
  "coach.listInsights": R,
  "coach.getInsight": R,

  "cockpit.today": R,
  "cockpit.weekly": R,
  "cockpit.weeklyReport": R,
  "cockpit.logReview": W,

  "comparison.get": R,
  "comparison.settings": R,
  "comparison.updateSettings": W,

  // Cron procedures carry no session (bearer secret); the jobs gate themselves.
  "cron.wearablesSync": ALWAYS,
  "cron.billingRun": ALWAYS,
  "cron.photoCleanupRun": ALWAYS,
  "cron.remindersDailyRun": ALWAYS,
  "cron.insightsRun": ALWAYS,
  "cron.ingestionRun": ALWAYS,

  "cycle.settings": R,
  "cycle.enable": W,
  "cycle.updateSettings": W,
  // Turning the module off erases its data: a data right.
  "cycle.turnOffAndErase": ALWAYS,
  "cycle.periods": R,
  "cycle.logPeriod": W,
  "cycle.updatePeriod": W,
  "cycle.deletePeriod": W,
  "cycle.importPeriods": W,
  "cycle.imports": R,
  "cycle.undoImport": W,
  "cycle.estimates": R,

  "bodyMap.composition": R,
  "bodyMap.training": R,

  "nutritionMicronutrients.summary": R,

  // #443 drinks: presets and opt-in totals are reads; a preset is logged via nutritionDiary.logEntry.
  "nutritionDrinks.presets": R,
  "nutritionDrinks.summary": R,
  "nutritionDrinks.lastCaffeine": R,

  // #89 data rights: always.
  "dataRights.deletionPreview": ALWAYS,
  "dataRights.deleteEverything": ALWAYS,
  "dataRights.exportRequest": ALWAYS,
  "dataRights.exportStatus": ALWAYS,
  "dataRights.exportCancel": ALWAYS,
  // Direct Bluetooth devices: registering one or uploading its minutes writes.
  "directDevice.listDirectDevices": R,
  "directDevice.registerDirectDevice": W,
  "directDevice.ingestDirectDeviceBatch": W,

  "example.echo": R,
  "example.protectedEcho": R,

  "exerciseCatalog.search": R,
  "exerciseCatalog.get": R,
  "exerciseCatalog.filters": R,
  "exerciseCatalog.createCustom": W,
  "exerciseCatalog.addFromLibrary": W,

  // Exports (JSON, CSV, PDF, clinical bundle): always (#89).
  "exports.clinicalBundle": ALWAYS,
  "exports.legacyDownload": ALWAYS,
  "exports.legacyPdfDownload": ALWAYS,

  "health.readiness": R,

  "healthRecord.resolveCanonicalMetric": R,
  "healthRecord.ingestMetricDefinition": W,
  "healthRecord.ingestMetricSample": W,
  "healthRecord.ingestWriteIngestionJob": W,
  "healthRecord.metricRetentionPolicy": R,
  "healthRecord.runMetricRetention": W,
  "healthRecord.runMetricDedupe": W,

  "ingestion.requestReplay": W,

  "insights.list": R,
  "insights.feedback": W,
  "insights.preferences.get": R,
  // Notification settings, devices and unsubscribe: opting out is never blocked.
  "insights.preferences.update": ALWAYS,
  "insights.pushDevices.register": ALWAYS,
  "insights.pushDevices.unregister": ALWAYS,
  "insights.unsubscribe": ALWAYS,

  "labs.latest": R,

  // Phone sync: paused while ended (the app checks `access.status` first).
  "mobile.registerDevice": W,
  "mobile.ingestBatch": W,
  "mobile.syncStatus": R,

  "nutritionCustomFoods.list": R,
  "nutritionCustomFoods.get": R,
  "nutritionCustomFoods.create": W,
  "nutritionCustomFoods.update": W,
  "nutritionCustomFoods.archive": W,
  "nutritionCustomFoods.restore": W,

  "nutritionCoach.getConsent": R,
  "nutritionCoach.grantConsent": W,
  "nutritionCoach.revokeConsent": ALWAYS,
  "nutritionCoach.previewContext": R,

  "nutritionDiary.getDay": R,
  "nutritionDiary.getTotals": R,
  "nutritionDiary.listFoods": R,
  "nutritionDiary.logEntry": W,
  "nutritionDiary.updateEntry": W,
  "nutritionDiary.deleteEntry": W,
  "nutritionDiary.restoreEntry": W,
  "nutritionDiary.setDayStatus": W,
  "nutritionDiary.copyDay": W,
  "nutritionDiary.logTemplate": W,
  "nutritionDiary.setFavorite": W,
  "nutritionDiary.createFood": W,

  "nutritionTemplates.list": R,
  "nutritionTemplates.create": W,
  "nutritionTemplates.update": W,
  "nutritionTemplates.archive": W,

  "nutritionEnergy.estimate": R,
  "nutritionEnergy.listProposals": R,
  "nutritionEnergy.propose": W,
  "nutritionEnergy.acceptProposal": W,
  "nutritionEnergy.dismissProposal": W,

  "nutritionFoodDrafts.provider": R,
  "nutritionFoodDrafts.parse": AI,
  "nutritionFoodDrafts.parsePhoto": AI,

  "nutritionFoods.search": R,
  "nutritionFoods.get": R,
  "nutritionFoods.lookupBarcode": R,

  "nutritionRecipeImport.fromUrl": W,

  "nutritionTargets.get": R,
  "nutritionTargets.setTarget": W,
  "nutritionTargets.clearTarget": W,
  "nutritionTargets.updateSettings": W,
  "nutritionTargets.loggingStreak": R,

  "plans.listSupplements": R,
  "plans.upsertSupplement": W,
  "plans.deleteSupplement": W,
  "plans.listMedications": R,
  "plans.upsertMedication": W,
  "plans.deleteMedication": W,
  "plans.listSchedules": R,
  "plans.upsertSchedule": W,
  "plans.deleteSchedule": W,
  "plans.listChanges": R,
  "plans.workouts.lastPerformance": R,
  "plans.workouts.exerciseHistory": R,
  "plans.workouts.listWorkouts": R,
  "plans.workouts.getWorkout": R,
  "plans.workouts.upsertWorkout": W,
  "plans.workouts.rateEffort": W,
  "plans.workouts.updateWorkout": W,
  "plans.workouts.deleteWorkout": W,
  "plans.routines.listRoutines": R,
  "plans.routines.getRoutine": R,
  "plans.routines.createRoutine": W,
  "plans.routines.updateRoutine": W,
  "plans.routines.deleteRoutine": W,
  "plans.routines.startPreview": R,
  "plans.goals.listGoals": R,
  "plans.goals.upsertGoal": W,
  "plans.goals.listCheckins": R,
  "plans.goals.upsertCheckin": W,
  "plans.goals.deleteGoal": W,
  // Personal goals and actual supplement intake have explicit workspace
  // access classes; reads remain available after a plan ends, writes do not.
  "goals.list": R,
  "goals.detail": R,
  "goals.create": W,
  "goals.update": W,
  "goals.setStatus": W,
  "goals.delete": W,
  "goals.createCheckin": W,
  "goals.updateCheckin": W,
  "goals.deleteCheckin": W,
  "goals.listNeedsConfiguration": R,
  "goals.configureLegacy": W,
  "goals.listUnassignedLegacy": R,
  "goals.assignLegacy": W,
  "supplementIntake.list": R,
  "supplementIntake.create": W,
  "supplementIntake.update": W,
  "supplementIntake.delete": W,
  "plans.calendar.listEvents": R,
  "plans.calendar.upsertEvent": W,
  "plans.calendar.deleteEvent": W,

  "plainWater.getPreferences": R,
  "plainWater.updatePreferences": W,
  "plainWater.getDay": R,
  "plainWater.add": W,
  "plainWater.change": W,
  "plainWater.delete": W,

  "preventiveCare.get": R,
  "preventiveCare.declare": W,
  "preventiveCare.updateItem": W,
  "preventiveCare.settings.update": W,
  "preventiveCare.library": R,

  "profile.get": R,
  "profile.update": W,

  // Quick log (#440): the palette and log picker read recents and due supplements.
  "quickLog.recents": R,
  "quickLog.supplementsDue": R,

  "privateBody.preference": R,
  "privateBody.setPreference": W,
  "privateBody.list": R,
  "privateBody.create": W,
  "privateBody.update": W,
  "privateBody.delete": W,
  "privateBody.photos": R,
  "privateBody.uploadPhoto": W,
  "privateBody.photoFile": R,

  "score.readiness": R,

  "sharing.listMembers": R,
  "sharing.listInvitations": R,
  "sharing.createInvitation": W,
  // Taking access away from someone is never blocked.
  "sharing.revokeInvitation": ALWAYS,
  "sharing.removeMember": ALWAYS,
  "sharing.me": R,

  "signIn.options": ALWAYS,
  "signUp.options": ALWAYS,
  "signUp.request": ALWAYS,
  "healthConsent.status": ALWAYS,
  "healthConsent.accept": ALWAYS,

  "sleep.summary": R,
  "sleep.listDailySummaries": R,
  "sleep.recordFromHealthConnect": W,
  "sleep.logManualSession": W,
  "sleep.manualSessions": R,
  "sleep.deleteManualSession": W,

  "storage.downloadUrl": R,
  "storage.delete": W,

  "telegram.status": R,
  "telegram.disconnect": ALWAYS,
  "telegram.issueConnectToken": W,

  // Custom trackers (#441).
  "trackers.list": R,
  "trackers.get": R,
  "trackers.entries": R,
  "trackers.chart": R,
  "trackers.create": W,
  "trackers.update": W,
  "trackers.setArchived": W,
  "trackers.delete": W,
  "trackers.log": W,
  "trackers.updateEntry": W,
  "trackers.deleteEntry": W,
  // #452: phone feeds. Linking and importing are writes; Cloud read-only blocks them.
  "trackers.feeds": R,
  "trackers.linkFeed": W,
  "trackers.unlinkFeed": W,
  "trackers.importFeed": W,

  // Pain log (#442).
  "pain.preference": R,
  "pain.setPreference": W,
  "pain.log": W,
  "pain.delete": W,
  "pain.map": R,
  "pain.history": R,

  "timeline.list": R,
  "timeline.changesSinceReview": R,
  "timeline.listMetrics": R,
  "timeline.listSourcePriority": R,
  "timeline.upsertSourcePreference": W,
  "timeline.deleteSourcePreference": W,
  "timeline.writeProvenanceLink": W,

  "vitals.daily": R,
  "vitals.recentSamples": R,
  "vitals.bloodPressureReadings": R,

  "wearables.list": R,
  "wearables.connect": W,
  // Disconnecting a vendor revokes its access to the account: never blocked.
  "wearables.disconnect": ALWAYS,
  "wearables.resolveQuarantine": W,
  "wearables.syncNow": W,

  // The "What's new" card (#446): a display preference, like the language.
  "whatsNew.get": R,
  "whatsNew.dismiss": ALWAYS,
  "whatsNew.setEnabled": ALWAYS,
});

/** The class of a procedure path; anything unlisted is `write` (default deny). */
export function procedureAccessClass(path: readonly string[]): ProcedureAccessClass {
  return PROCEDURE_ACCESS[path.join(".")] ?? "write";
}

/** Whether a procedure of this class may run on a read-only (ended) workspace. */
export function allowedWhenReadOnly(accessClass: ProcedureAccessClass): boolean {
  return accessClass === "read" || accessClass === "always";
}
