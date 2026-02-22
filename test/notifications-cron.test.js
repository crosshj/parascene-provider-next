import { describe, it, expect, jest } from "@jest/globals";
import { sendTemplatedEmailMock, setupEmailMock } from "./mocks/email.js";
import { setupEmailSettingsMock, fakeEmailSettings } from "./mocks/emailSettings.js";
import { createNotificationsCronQueries } from "./mocks/notificationsCronQueries.js";

// Register module mocks before importing the worker under test.
setupEmailMock();
setupEmailSettingsMock();

const { runNotificationsCronForTests } = await import("../api/worker/notifications.js");

describe("notifications worker cron", () => {
	it("marks welcome step complete when a digest is sent, without inserting a separate welcome send", async () => {
		sendTemplatedEmailMock.mockClear();
		const queries = createNotificationsCronQueries();

		const result = await runNotificationsCronForTests({ queries });

		expect(result.ok).toBe(true);
		expect(result.sent).toBe(1);

		// Only the digest template should have been sent.
		expect(sendTemplatedEmailMock).toHaveBeenCalledTimes(1);
		expect(sendTemplatedEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({ template: "digestActivity" })
		);

		// DB "sends" records should contain a digest but no welcome row.
		const digestSends = queries.insertEmailSend.run.mock.calls.filter(
			([, campaign]) => campaign === "digest"
		);
		const welcomeSends = queries.insertEmailSend.run.mock.calls.filter(
			([, campaign]) => campaign === "welcome"
		);

		expect(digestSends.length).toBe(1);
		expect(welcomeSends.length).toBe(0);

		// However, the campaign state for welcome should still be marked as completed
		// via markPreviousStepsCompleted("digest" → "welcome").
		expect(queries.upsertUserEmailCampaignStateWelcome.run).toHaveBeenCalledTimes(1);
	});

	it("sends a welcome email when user is eligible and not blocked by later campaigns", async () => {
		sendTemplatedEmailMock.mockClear();
		const queries = createNotificationsCronQueries({
			// No digest candidates this run.
			selectDistinctUserIdsWithUnreadNotificationsSince: {
				all: jest.fn(async () => [])
			},
			// One user eligible for welcome email.
			selectUsersEligibleForWelcomeEmail: {
				all: jest.fn(async () => [{ user_id: 1 }])
			}
		});

		const result = await runNotificationsCronForTests({ queries });

		expect(result.ok).toBe(true);
		// No digest sent; welcome should be recorded instead.
		expect(result.sent).toBe(0);
		expect(result.welcomeSent).toBe(1);

		// Only the welcome template should have been sent.
		expect(sendTemplatedEmailMock).toHaveBeenCalledTimes(1);
		expect(sendTemplatedEmailMock).toHaveBeenCalledWith(
			expect.objectContaining({ template: "welcome" })
		);

		// DB "sends" records should contain a welcome row but no digest row.
		const digestSends = queries.insertEmailSend.run.mock.calls.filter(
			([, campaign]) => campaign === "digest"
		);
		const welcomeSends = queries.insertEmailSend.run.mock.calls.filter(
			([, campaign]) => campaign === "welcome"
		);

		expect(digestSends.length).toBe(0);
		expect(welcomeSends.length).toBe(1);

		// Campaign state for welcome should be marked as completed directly.
		expect(queries.upsertUserEmailCampaignStateWelcome.run).toHaveBeenCalledTimes(1);
	});

	it("returns not_in_window and sends nothing when current hour is outside digest window", async () => {
		sendTemplatedEmailMock.mockClear();

		// Force the system clock to an hour that is NOT in the configured windowHours.
		const configuredHour = fakeEmailSettings.windowHours[0];
		const blockedHour = (configuredHour + 1) % 24;
		jest.useFakeTimers();
		jest.setSystemTime(new Date(Date.UTC(2024, 0, 1, blockedHour, 0, 0)));

		const queries = createNotificationsCronQueries();
		const result = await runNotificationsCronForTests({ queries });

		expect(result.ok).toBe(true);
		expect(result.reason).toBe("not_in_window");
		expect(result.currentHourUTC).toBe(blockedHour);
		expect(result.windowHours).toEqual(fakeEmailSettings.windowHours);

		// No emails should have been attempted or recorded.
		expect(sendTemplatedEmailMock).not.toHaveBeenCalled();
		expect(queries.insertEmailSend.run).not.toHaveBeenCalled();

		jest.useRealTimers();
	});
});

