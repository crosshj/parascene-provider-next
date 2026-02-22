/**
 * Campaign "previous steps" logic: when we send certain emails, we mark earlier
 * lifecycle steps as completed so we never send those emails to that user later.
 *
 * Rule: If a user qualifies for one of these "later" campaigns in a given run,
 * we (1) mark the previous steps as done, and (2) do NOT send welcome or
 * first-creation nudge to that user in the same run.
 *
 * Single source of truth for "campaign X implies steps Y are done".
 */

/** Steps we can mark as completed (keys match adapter method names). */
const STEP_METHODS = {
	welcome: "upsertUserEmailCampaignStateWelcome",
	first_creation_nudge: "upsertUserEmailCampaignStateFirstCreationNudge"
};

/**
 * Campaigns that imply previous steps. When we send one of these, we mark
 * welcome + first_creation_nudge as done and we must not send welcome or
 * first_creation_nudge to that user in the same cron run.
 */
export const CAMPAIGNS_THAT_IMPLY_PREVIOUS_STEPS = ["digest", "reengagement", "creation_highlight"];

/**
 * When we send this campaign, mark these previous steps as done.
 * - digest: user has activity → considered welcomed and already creating
 * - reengagement: "we miss you" → treat as welcomed and nudged
 * - creation_highlight: "creation getting attention" → engaged, welcomed, has created
 */
export const CAMPAIGN_IMPLIES_STEPS = {
	digest: ["welcome", "first_creation_nudge"],
	reengagement: ["welcome", "first_creation_nudge"],
	creation_highlight: ["welcome", "first_creation_nudge"]
};

/**
 * After sending a campaign email, mark any implied previous steps as completed.
 * Call this once per successful send so we never send "earlier" emails to that user later.
 *
 * @param {object} queries - DB queries object
 * @param {number} userId - User id
 * @param {string} sentAt - ISO timestamp (e.g. new Date().toISOString())
 * @param {string} campaign - Campaign key, e.g. "digest", "reengagement", "creation_highlight"
 */
export async function markPreviousStepsCompleted(queries, userId, sentAt, campaign) {
	const steps = CAMPAIGN_IMPLIES_STEPS[campaign];
	if (!steps || !Array.isArray(steps)) return;
	for (const step of steps) {
		const methodName = STEP_METHODS[step];
		const run = methodName && queries[methodName]?.run;
		if (run) await run(userId, sentAt);
	}
}
