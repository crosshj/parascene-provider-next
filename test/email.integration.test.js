import { sendTemplatedEmail } from "../email/index.js";

const TEST_RECIPIENT = "parascene@crosshj.com";
const REQUIRED_ENV = ["RESEND_API_KEY", "RESEND_SYSTEM_EMAIL"];

function ensureEnv() {
	const missing = REQUIRED_ENV.filter((key) => !process.env[key]);
	if (missing.length > 0) {
		throw new Error(
			`Missing required environment variables for Resend test: ${missing.join(", ")}`
		);
	}
}

describe("Resend Email Integration", () => {
	it("should send the hello from parascene template", async () => {
		ensureEnv();

		const response = await sendTemplatedEmail({
			to: TEST_RECIPIENT,
			template: "helloFromParascene",
			data: {
				recipientName: "Cool Guy"
			}
		});

		expect(response?.id).toBeTruthy();
	}, 30000);
});
