import express from "express";
import { buildProviderHeaders, resolveProviderAuthToken } from "./utils/providerAuth.js";

export default function createProviderRoutes({ queries }) {
	const router = express.Router();

	async function requireUser(req, res) {
		if (!req.auth?.userId) {
			res.status(401).json({ error: "Unauthorized" });
			return null;
		}

		const user = await queries.selectUserById.get(req.auth?.userId);
		if (!user) {
			res.status(404).json({ error: "User not found" });
			return null;
		}

		return user;
	}

	async function requireAdminOrProvider(req, res) {
		const user = await requireUser(req, res);
		if (!user) return null;

		if (user.role !== 'admin' && user.role !== 'provider') {
			res.status(403).json({ error: "Forbidden: Admin or Provider role required" });
			return null;
		}

		return user;
	}

	router.get("/api/provider/status", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		// Return empty array - status data now comes from servers table
		return res.json({ statuses: [] });
	});

	router.get("/api/provider/metrics", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		// Return empty array - metrics table removed
		return res.json({ metrics: [] });
	});

	router.get("/api/provider/grants", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		// Return empty array - grants table removed
		return res.json({ grants: [] });
	});

	router.get("/api/provider/templates-hosted", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		// Return empty array - provider_templates table removed
		return res.json({ templates: [] });
	});

	router.post("/api/provider/register", async (req, res) => {
		const user = await requireAdminOrProvider(req, res);
		if (!user) return;

		const { name, server_url, auth_token } = req.body;

		// Validate required fields
		if (!name || typeof name !== 'string' || name.trim() === '') {
			return res.status(400).json({ error: "name is required and must be a non-empty string" });
		}
		if (!server_url || typeof server_url !== 'string' || server_url.trim() === '') {
			return res.status(400).json({ error: "server_url is required and must be a non-empty string" });
		}

		if (auth_token !== undefined && auth_token !== null && typeof auth_token !== 'string') {
			return res.status(400).json({ error: "auth_token must be a string when provided" });
		}

		const resolvedAuthToken = resolveProviderAuthToken(auth_token);

		// Validate server_url is a valid URL
		let providerUrl;
		try {
			providerUrl = new URL(server_url.trim());
			if (!['http:', 'https:'].includes(providerUrl.protocol)) {
				return res.status(400).json({ error: "server_url must be an HTTP or HTTPS URL" });
			}
		} catch (urlError) {
			return res.status(400).json({ error: "server_url must be a valid URL" });
		}

		// Normalize server_url (remove trailing slash)
		const normalizedUrl = providerUrl.toString().replace(/\/$/, '');

		// Verify provider server is accessible and get capabilities
		let capabilities;
		try {
			const response = await fetch(normalizedUrl, {
				method: 'GET',
				headers: buildProviderHeaders({
					'Accept': 'application/json'
				}, resolvedAuthToken),
				signal: AbortSignal.timeout(10000) // 10 second timeout
			});

			if (!response.ok) {
				return res.status(400).json({
					error: `Provider server returned error: ${response.status} ${response.statusText}`,
					server_url: normalizedUrl
				});
			}

			capabilities = await response.json();

			// Validate response structure
			if (!capabilities.methods || typeof capabilities.methods !== 'object') {
				return res.status(400).json({
					error: "Provider server response missing or invalid 'methods' field",
					server_url: normalizedUrl
				});
			}
		} catch (fetchError) {
			if (fetchError.name === 'AbortError') {
				return res.status(400).json({
					error: "Provider server did not respond within 10 seconds",
					server_url: normalizedUrl
				});
			}
			return res.status(400).json({
				error: `Failed to connect to provider server: ${fetchError.message}`,
				server_url: normalizedUrl
			});
		}

		// Insert provider into registry with "pending" status and server configuration
		try {
			const result = await queries.insertProvider.run(
				user.id,
				name.trim(),
				'pending',
				normalizedUrl,
				capabilities, // Store the full capabilities response as server_config
				resolvedAuthToken
			);

			const provider = {
				id: result.insertId,
				user_id: user.id,
				name: name.trim(),
				status: 'pending',
				server_url: normalizedUrl,
				owner_email: user.email,
				server_config: capabilities,
				auth_token: resolvedAuthToken,
				created_at: new Date().toISOString()
			};

			return res.status(201).json({ provider });
		} catch (dbError) {
			// console.error('Error inserting provider:', dbError);
			return res.status(500).json({
				error: "Failed to register provider",
				message: dbError.message
			});
		}
	});

	router.post("/api/provider/test", async (req, res) => {
		const user = await requireAdminOrProvider(req, res);
		if (!user) return;

		const { server_url, auth_token } = req.body;

		if (auth_token !== undefined && auth_token !== null && typeof auth_token !== 'string') {
			return res.status(400).json({ error: "auth_token must be a string when provided" });
		}

		const resolvedAuthToken = resolveProviderAuthToken(auth_token);

		if (!server_url || typeof server_url !== 'string' || server_url.trim() === '') {
			return res.status(400).json({ error: "server_url is required and must be a non-empty string" });
		}

		// Validate server_url is a valid URL
		let providerUrl;
		try {
			providerUrl = new URL(server_url.trim());
			if (!['http:', 'https:'].includes(providerUrl.protocol)) {
				return res.status(400).json({ error: "server_url must be an HTTP or HTTPS URL" });
			}
		} catch (urlError) {
			return res.status(400).json({ error: "server_url must be a valid URL" });
		}

		// Normalize server_url (remove trailing slash)
		const normalizedUrl = providerUrl.toString().replace(/\/$/, '');

		// Call provider server to get capabilities
		try {
			const response = await fetch(normalizedUrl, {
				method: 'GET',
				headers: buildProviderHeaders({
					'Accept': 'application/json'
				}, resolvedAuthToken),
				signal: AbortSignal.timeout(10000) // 10 second timeout
			});

			if (!response.ok) {
				return res.status(400).json({
					error: `Provider server returned error: ${response.status} ${response.statusText}`,
					server_url: normalizedUrl
				});
			}

			const capabilities = await response.json();

			// Validate response structure
			if (!capabilities.methods || typeof capabilities.methods !== 'object') {
				return res.status(400).json({
					error: "Provider server response missing or invalid 'methods' field",
					server_url: normalizedUrl
				});
			}

			return res.status(200).json({
				capabilities,
				server_url: normalizedUrl
			});
		} catch (fetchError) {
			if (fetchError.name === 'AbortError') {
				return res.status(400).json({
					error: "Provider server did not respond within 10 seconds",
					server_url: normalizedUrl
				});
			}
			return res.status(400).json({
				error: `Failed to connect to provider server: ${fetchError.message}`,
				server_url: normalizedUrl
			});
		}
	});

	return router;
}
