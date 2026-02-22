import { jest } from "@jest/globals";


export function createNotificationsCronQueries(overrides = {}) {
	const insertEmailSendRun = jest.fn(async () => ({ changes: 1 }));
	const upsertWelcomeRun = jest.fn(async () => ({ changes: 1 }));

	const base = {
		// One user with unread notifications → eligible for digest.
		selectDistinctUserIdsWithUnreadNotificationsSince: {
			all: jest.fn(async () => [{ user_id: 1 }])
		},
		selectUserById: {
			get: jest.fn(async (userId) => ({
				id: userId,
				email: "user@example.com",
				display_name: "User",
				user_name: "user",
				role: "consumer"
			}))
		},
		selectEmailSendsCountForUserSince: {
			get: jest.fn(async () => ({ count: 0 }))
		},
		selectNotificationsForUser: {
			all: jest.fn(async () => [])
		},
		selectDigestActivityByOwnerSince: {
			all: jest.fn(async () => [])
		},
		selectDigestActivityByCommenterSince: {
			all: jest.fn(async () => [])
		},
		// No re-engagement / highlight / welcome / nudge candidates for this test.
		selectUsersEligibleForReengagement: {
			all: jest.fn(async () => [])
		},
		selectCreationsEligibleForHighlight: {
			all: jest.fn(async () => [])
		},
		selectUsersEligibleForWelcomeEmail: {
			all: jest.fn(async () => [])
		},
		selectUsersEligibleForFirstCreationNudge: {
			all: jest.fn(async () => [])
		},
		insertEmailSend: {
			run: insertEmailSendRun
		},
		upsertUserEmailCampaignStateLastDigest: {
			run: jest.fn(async () => ({ changes: 1 }))
		},
		upsertUserEmailCampaignStateWelcome: {
			run: upsertWelcomeRun
		},
		upsertUserEmailCampaignStateFirstCreationNudge: {
			run: jest.fn(async () => ({ changes: 1 }))
		},
		upsertUserEmailCampaignStateReengagement: {
			run: jest.fn(async () => ({ changes: 1 }))
		},
		upsertUserEmailCampaignStateCreationHighlight: {
			run: jest.fn(async () => ({ changes: 1 }))
		}
	};

	return { ...base, ...overrides };
}

