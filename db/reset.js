import "dotenv/config";
import { openDb } from "./index.js";
import { seedDatabase } from "./seed.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function clearImagesDirectory(dirPath) {
	if (fs.existsSync(dirPath)) {
		const files = fs.readdirSync(dirPath);
		for (const file of files) {
			const filePath = path.join(dirPath, file);
			const stat = fs.statSync(filePath);
			if (stat.isFile()) {
				fs.unlinkSync(filePath);
			} else if (stat.isDirectory()) {
				clearImagesDirectory(filePath);
				fs.rmdirSync(filePath);
			}
		}
	}
}

try {
	// Ensure we're using Supabase adapter
	process.env.DB_ADAPTER = process.env.DB_ADAPTER || 'supabase';

	// Get database instance with storage
	const dbInstance = await openDb();
	const { reset, storage } = dbInstance;

	// Clear images using storage adapter
	if (storage && storage.clearAll) {
		// console.log("Clearing images using storage adapter...");
		await storage.clearAll();
		// console.log("Images cleared.");
	} else {
		// Fallback to manual clearing for filesystem-based adapters
		const imagesDir = path.join(__dirname, "data", "images");
		const createdDir = path.join(imagesDir, "created");
		const generatedDir = path.join(imagesDir, "generated");

		// console.log("Clearing images from data folder...");
		clearImagesDirectory(createdDir);
		clearImagesDirectory(generatedDir);
		// console.log("Images cleared.");
	}

	// Use adapter's reset method if available
	if (reset) {
		// console.log("Resetting database tables...");
		await reset();
		// console.log("Database tables cleared.");
	}

	await seedDatabase(dbInstance);
	// console.log("Database reset complete.");
} catch (error) {
	// console.error("Database reset error:", error);
	process.exit(1);
}
