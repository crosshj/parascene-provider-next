import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

function requireEnv(name) {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required env var ${name}`);
	}
	return value;
}

async function listAllFiles(storage, bucket, prefix = "") {
	const files = [];
	let offset = 0;
	const limit = 100;

	while (true) {
		const { data, error } = await storage.from(bucket).list(prefix, {
			limit,
			offset,
			sortBy: { column: "name", order: "asc" }
		});
		if (error) {
			throw new Error(`Failed to list files in ${bucket}: ${error.message}`);
		}
		if (!data || data.length === 0) {
			break;
		}
		for (const item of data) {
			if (item.name && !item.name.endsWith("/")) {
				const fullName = prefix ? `${prefix}/${item.name}` : item.name;
				files.push(fullName);
			}
		}
		offset += data.length;
	}

	return files;
}

async function main() {
	const supabaseUrl = requireEnv("SUPABASE_URL");
	const serviceRoleKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

	const storageBucket = process.env.SUPABASE_IMAGE_BUCKET || "prsn_created-images";
	const thumbnailBucket =
		process.env.SUPABASE_THUMBNAIL_BUCKET || "prsn_created-images-thumbnails";
	const prefix = process.argv[2] || "";

	const client = createClient(supabaseUrl, serviceRoleKey);
	const storage = client.storage;

	const { data: buckets, error: bucketsError } = await storage.listBuckets();
	if (bucketsError) {
		throw new Error(`Failed to list buckets: ${bucketsError.message}`);
	}
	const bucketNames = new Set((buckets ?? []).map((bucket) => bucket.name));
	if (!bucketNames.has(storageBucket)) {
		throw new Error(
			`Bucket not found: ${storageBucket}. Available: ${[...bucketNames].join(", ")}`
		);
	}
	if (!bucketNames.has(thumbnailBucket)) {
		throw new Error(
			`Bucket not found: ${thumbnailBucket}. Available: ${[...bucketNames].join(", ")}`
		);
	}

	// console.log(`Clearing thumbnail bucket ${thumbnailBucket}...`);
	const existingThumbnails = await listAllFiles(storage, thumbnailBucket, prefix);
	if (existingThumbnails.length > 0) {
		const chunkSize = 1000;
		for (let i = 0; i < existingThumbnails.length; i += chunkSize) {
			const chunk = existingThumbnails.slice(i, i + chunkSize);
			const { error: removeError } = await storage
				.from(thumbnailBucket)
				.remove(chunk);
			if (removeError) {
				throw new Error(
					`Failed to clear thumbnails: ${removeError.message}`
				);
			}
		}
	}
	// console.log(`Cleared ${existingThumbnails.length} thumbnails.`);

	// console.log(`Listing source images from ${storageBucket}...`);
	const sourceFiles = await listAllFiles(storage, storageBucket, prefix);
	// console.log(`Found ${sourceFiles.length} images.`);

	let processed = 0;
	let created = 0;

	for (const filename of sourceFiles) {
		processed += 1;

		const { data, error } = await storage.from(storageBucket).download(filename);
		if (error) {
			console.warn(`Skip ${filename}: download failed (${error.message})`);
			continue;
		}

		const arrayBuffer = await data.arrayBuffer();
		const buffer = Buffer.from(arrayBuffer);

		const thumbnailBuffer = await sharp(buffer)
			.resize(250, 250, { fit: "cover" })
			.png()
			.toBuffer();

		const { error: uploadError } = await storage
			.from(thumbnailBucket)
			.upload(filename, thumbnailBuffer, {
				contentType: "image/png",
				upsert: true
			});

		if (uploadError) {
			console.warn(`Skip ${filename}: upload failed (${uploadError.message})`);
			continue;
		}

		created += 1;

		if (processed % 50 === 0) {
			// console.log(`Processed ${processed}/${sourceFiles.length}...`);
		}
	}

	// console.log(
	`Done. processed=${processed} created=${created}`
  );
}

main().catch((error) => {
	// console.error(error);
	process.exitCode = 1;
});
