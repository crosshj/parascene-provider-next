import "dotenv/config";
import { openDb } from "../index.js";

async function main() {
	const args = process.argv.slice(2);

	if (args.length < 2) {
		// console.error("Usage: node db/maintenance/add_credits.js <email|userId> <amount>");
		// console.error("Example: node db/maintenance/add_credits.js user@example.com 50");
		// console.error("Example: node db/maintenance/add_credits.js 123 -25");
		process.exitCode = 1;
		return;
	}

	const userIdentifier = args[0];
	const amount = parseFloat(args[1]);

	if (isNaN(amount)) {
		// console.error(`Error: Invalid amount "${args[1]}" - must be a number`);
		process.exitCode = 1;
		return;
	}

	try {
		const { queries } = await openDb({ quiet: true });

		// Find user by email or ID
		let user;
		const userIdNum = parseInt(userIdentifier, 10);
		if (!isNaN(userIdNum)) {
			user = await queries.selectUserById.get(userIdNum);
		} else {
			user = await queries.selectUserByEmail.get(userIdentifier);
		}

		if (!user) {
			// console.error(`Error: User not found (${userIdentifier})`);
			process.exitCode = 1;
			return;
		}

		// console.log(`Found user: ${user.email} (ID: ${user.id})`);

		// Get current credits
		let credits = await queries.selectUserCredits.get(user.id);

		const oldBalance = credits?.balance ?? 0;

		// Initialize credits if doesn't exist
		if (!credits) {
			// console.log("No credits record found, initializing...");
			await queries.insertUserCredits.run(user.id, 0, null);
			credits = await queries.selectUserCredits.get(user.id);
		}

		// Update balance
		await queries.updateUserCreditsBalance.run(user.id, amount);

		// Get new balance
		const updatedCredits = await queries.selectUserCredits.get(user.id);
		const newBalance = updatedCredits.balance;

		// console.log(`\nCredits updated:`);
		// console.log(`  Old balance: ${oldBalance.toFixed(1)}`);
		// console.log(`  Amount: ${amount >= 0 ? '+' : ''}${amount.toFixed(1)}`);
		// console.log(`  New balance: ${newBalance.toFixed(1)}`);
		// console.log(`\n✓ Success!`);

	} catch (error) {
		// console.error("Error:", error.message);
		if (error.stack) {
			// console.error(error.stack);
		}
		process.exitCode = 1;
	}
}

main().catch((error) => {
	// console.error(error);
	process.exitCode = 1;
});
