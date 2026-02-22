import { jest } from "@jest/globals";

// Default deterministic settings for notifications cron tests.
const currentHourUTC = new Date().getUTCHours();

export const fakeEmailSettings = {
	emailUseTestRecipient: false,
	dryRun: false,
	windowHours: [currentHourUTC],
	maxDigestsPerUserPerDay: 10,
	activityHoursLookback: 24,
	reengagementInactiveDays: 14,
	reengagementCooldownDays: 30,
	creationHighlightLookbackHours: 48,
	creationHighlightCooldownDays: 7,
	creationHighlightMinComments: 0,
	welcomeEmailDelayHours: 0,
	digestUtcWindowsRaw: `${String(currentHourUTC).padStart(2, "0")}:00`
};

/**
 * Register a Jest ESM module mock for the email settings utilities.
 * Must be called before importing any module that imports "../api_routes/utils/emailSettings.js".
 *
 * @param {Partial<typeof fakeEmailSettings>} [overrides]
 */
export function setupEmailSettingsMock(overrides = {}) {
	const settings = { ...fakeEmailSettings, ...overrides };
	jest.unstable_mockModule("../../api_routes/utils/emailSettings.js", () => ({
		getEmailSettings: jest.fn().mockResolvedValue(settings),
		getEffectiveRecipient: (_settings, intendedRecipient) => intendedRecipient
	}));
}

