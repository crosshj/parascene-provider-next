import { jest } from "@jest/globals";

// Shared mock for sendTemplatedEmail so tests can assert on usage.
export const sendTemplatedEmailMock = jest.fn().mockResolvedValue({ id: "test-email-id" });

/**
 * Register a Jest ESM module mock for the email index module.
 * Must be called before importing any module that imports "../email/index.js".
 */
export function setupEmailMock() {
	jest.unstable_mockModule("../../email/index.js", () => ({
		sendTemplatedEmail: sendTemplatedEmailMock
	}));
}

