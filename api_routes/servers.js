import express from "express";
import { buildProviderHeaders, resolveProviderAuthToken } from "./utils/providerAuth.js";

export default function createServersRoutes({ queries }) {
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

	// Helper function to add permission flags to servers
	async function addPermissionFlags(servers, userId, isAdmin = false) {
		return Promise.all(servers.map(async (server) => {
			const isSpecial = server.id === 1;
			// "Owner" means the user who originally created the server.
			// Admins can still manage all servers, but are not treated as owners.
			const isOwner = server.user_id === userId;
			let isMember = await queries.checkServerMembership.get(server.id, userId);
			if (isSpecial) {
				// All authenticated users are treated as members of the special server.
				isMember = true;
			}
			const canManage = isOwner || isAdmin;

			const result = {
				id: server.id,
				name: server.name,
				description: server.description,
				status: server.status,
				// Special server should not expose member counts.
				members_count: isSpecial ? null : (server.members_count || 0),
				created_at: server.created_at,
				is_owner: isOwner,
				is_member: isMember,
				can_manage: canManage,
				// Any authenticated user can conceptually join/leave; frontend / special rules decide controls.
				can_join_leave: !isSpecial,
				suspended: server.status === 'suspended'
			};

			// Include owner information for display
			if (server.user_id) {
				const ownerUser = await queries.selectUserById.get(server.user_id);
				const ownerProfile = ownerUser ? await queries.selectUserProfileByUserId?.get(server.user_id) : null;

				if (ownerUser) {
					const emailPrefix = ownerUser.email ? ownerUser.email.split('@')[0] : null;
					const displayName = ownerProfile?.display_name?.trim() || ownerProfile?.user_name?.trim() || emailPrefix || `User ${ownerUser.id}`;
					const userName = ownerProfile?.user_name?.trim() || emailPrefix || null;
					const avatarUrl = ownerProfile?.avatar_url?.trim() || null;

					result.owner = {
						id: ownerUser.id,
						display_name: displayName,
						user_name: userName,
						avatar_url: avatarUrl,
						email_prefix: emailPrefix
					};
				}
			}

			// Only include sensitive fields if user can manage
			if (canManage) {
				result.server_url = server.server_url;
				result.auth_token = server.auth_token;
				result.server_config = server.server_config;
			} else if (server.server_config && (isSpecial || isMember)) {
				// Special server's generation methods are available to all users.
				// For non-special servers, expose server_config to members so they can
				// use the generation methods, but do not expose URL or auth_token.
				result.server_config = server.server_config;
			}

			return result;
		}));
	}

	// GET /api/servers - List all servers with permission flags
	router.get("/api/servers", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const isAdmin = user.role === 'admin';
		let servers = await queries.selectServers.all();
		// Non-admins never see suspended servers (status = 'suspended').
		if (!isAdmin) {
			servers = servers.filter(s => s.status !== 'suspended');
		}
		// Ensure stable ascending ID order from the API.
		servers.sort((a, b) => {
			const aId = Number(a?.id) || 0;
			const bId = Number(b?.id) || 0;
			return aId - bId;
		});
		const serversWithFlags = await addPermissionFlags(servers, user.id, isAdmin);

		return res.json({ servers: serversWithFlags, viewer_is_admin: isAdmin });
	});

	// GET /api/servers/:id - Get server details with permission-based filtering
	router.get("/api/servers/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const isAdmin = user.role === 'admin';
		// Non-admins cannot see suspended servers (status = 'suspended').
		if (server.status === 'suspended' && !isAdmin) {
			return res.status(404).json({ error: "Server not found" });
		}

		const isSpecial = server.id === 1;
		// "Owner" means the user who originally created the server.
		// Admins can still manage all servers, but are not treated as owners.
		const isOwner = server.user_id === user.id;
		let isMember = await queries.checkServerMembership.get(serverId, user.id);
		if (isSpecial) {
			isMember = true;
		}
		const canManage = isOwner || isAdmin;

		const result = {
			id: server.id,
			name: server.name,
			description: server.description,
			status: server.status,
			members_count: isSpecial ? null : (server.members_count || 0),
			created_at: server.created_at,
			updated_at: server.updated_at,
			is_owner: isOwner,
			is_member: isMember,
			can_manage: canManage,
			can_join_leave: !isSpecial,
			suspended: server.status === 'suspended',
			viewer_is_admin: isAdmin
		};

		// Include owner information for display
		if (server.user_id) {
			const ownerUser = await queries.selectUserById.get(server.user_id);
			const ownerProfile = ownerUser ? await queries.selectUserProfileByUserId?.get(server.user_id) : null;

			if (ownerUser) {
				const emailPrefix = ownerUser.email ? ownerUser.email.split('@')[0] : null;
				const displayName = ownerProfile?.display_name?.trim() || ownerProfile?.user_name?.trim() || emailPrefix || `User ${ownerUser.id}`;
				const userName = ownerProfile?.user_name?.trim() || emailPrefix || null;
				const avatarUrl = ownerProfile?.avatar_url?.trim() || null;

				result.owner = {
					id: ownerUser.id,
					display_name: displayName,
					user_name: userName,
					avatar_url: avatarUrl,
					email_prefix: emailPrefix
				};
			}
		}

		// Only include sensitive fields if user can manage
		if (canManage) {
			result.server_url = server.server_url;
			result.auth_token = server.auth_token;
			result.server_config = server.server_config;
		} else if (server.server_config && (isSpecial || isMember)) {
			// Special server's generation methods are available to all users.
			// For non-special servers, expose server_config to members so they can
			// see and use the available generation methods.
			result.server_config = server.server_config;
		}

		return res.json({ server: result });
	});

	// POST /api/servers - Register new server
	router.post("/api/servers", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const { name, server_url, auth_token, description, status = 'active' } = req.body;

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

		// Insert server into database
		try {
			const insertResult = await queries.insertServer.run(
				user.id,
				name.trim(),
				status,
				normalizedUrl,
				capabilities,
				resolvedAuthToken,
				description?.trim() || null
			);

			const newServer = await queries.selectServerById.get(insertResult.insertId);
			if (!newServer) {
				return res.status(500).json({ error: "Failed to retrieve created server" });
			}

			// Add permission flags
			const isAdmin = user.role === 'admin';
			const serversWithFlags = await addPermissionFlags([newServer], user.id, isAdmin);

			return res.status(201).json({
				success: true,
				server: serversWithFlags[0]
			});
		} catch (dbError) {
			// console.error("Database error creating server:", dbError);
			return res.status(500).json({ error: "Failed to create server" });
		}
	});

	// PUT /api/servers/:id - Update server (requires can_manage)
	router.put("/api/servers/:id", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const isAdmin = user.role === 'admin';
		const canManage = server.user_id === user.id || isAdmin;
		if (!canManage) {
			return res.status(403).json({ error: "Forbidden: You do not have permission to manage this server" });
		}

		const payload = req.body || {};
		const nextServer = { ...server };

		if (payload.name !== undefined) {
			const nextName = String(payload.name || "").trim();
			if (!nextName) {
				return res.status(400).json({ error: "name must be a non-empty string when provided" });
			}
			nextServer.name = nextName;
		}

		if (payload.status !== undefined) {
			const nextStatus = String(payload.status || "").trim();
			if (!nextStatus) {
				return res.status(400).json({ error: "status must be a non-empty string when provided" });
			}
			// Only admins can set or clear status 'suspended'.
			if (nextStatus === 'suspended' || server.status === 'suspended') {
				if (!isAdmin) {
					return res.status(403).json({ error: "Forbidden: Only admins can set or change suspended status" });
				}
			}
			nextServer.status = nextStatus;
		}

		if (payload.server_url !== undefined) {
			if (typeof payload.server_url !== "string" || payload.server_url.trim() === "") {
				return res.status(400).json({ error: "server_url must be a non-empty string when provided" });
			}
			let providerUrl;
			try {
				providerUrl = new URL(payload.server_url.trim());
				if (!['http:', 'https:'].includes(providerUrl.protocol)) {
					return res.status(400).json({ error: "server_url must be an HTTP or HTTPS URL" });
				}
			} catch (urlError) {
				return res.status(400).json({ error: "server_url must be a valid URL" });
			}
			nextServer.server_url = providerUrl.toString().replace(/\/$/, '');
		}

		if (payload.auth_token !== undefined) {
			if (payload.auth_token !== null && typeof payload.auth_token !== "string") {
				return res.status(400).json({ error: "auth_token must be a string when provided" });
			}
			nextServer.auth_token = resolveProviderAuthToken(payload.auth_token);
		}

		if (payload.description !== undefined) {
			nextServer.description = payload.description || null;
		}

		const updateResult = await queries.updateServer.run(serverId, nextServer);
		if (updateResult.changes === 0) {
			return res.status(500).json({ error: "Failed to update server" });
		}

		const updatedServer = await queries.selectServerById.get(serverId);
		const serversWithFlags = await addPermissionFlags([updatedServer], user.id, isAdmin);

		return res.status(200).json({
			success: true,
			server: serversWithFlags[0]
		});
	});

	// POST /api/servers/:id/join - Join a server
	router.post("/api/servers/:id/join", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		// Special server: everyone is implicitly a member; joining is unnecessary.
		if (server.id === 1) {
			return res.status(400).json({ error: "You are already a member of this server" });
		}

		// Check if already a member
		const isMember = await queries.checkServerMembership.get(serverId, user.id);
		if (isMember) {
			return res.status(400).json({ error: "You are already a member of this server" });
		}

		try {
			await queries.addServerMember.run(serverId, user.id);
			return res.status(200).json({ success: true });
		} catch (error) {
			// console.error("Error joining server:", error);
			return res.status(500).json({ error: "Failed to join server" });
		}
	});

	// POST /api/servers/:id/leave - Leave a server
	router.post("/api/servers/:id/leave", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		// Special server: users cannot leave.
		if (server.id === 1) {
			return res.status(400).json({ error: "You cannot leave this server" });
		}

		// Check if user is the owner
		if (server.user_id === user.id) {
			return res.status(400).json({ error: "Server owners cannot leave their own server" });
		}

		// Check if actually a member
		const isMember = await queries.checkServerMembership.get(serverId, user.id);
		if (!isMember) {
			return res.status(400).json({ error: "You are not a member of this server" });
		}

		try {
			await queries.removeServerMember.run(serverId, user.id);
			return res.status(200).json({ success: true });
		} catch (error) {
			// console.error("Error leaving server:", error);
			return res.status(500).json({ error: "Failed to leave server" });
		}
	});

	// POST /api/servers/:id/test - Test server connection (requires can_manage)
	router.post("/api/servers/:id/test", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const isAdmin = user.role === 'admin';
		const canManage = server.user_id === user.id || isAdmin;
		if (!canManage) {
			return res.status(403).json({ error: "Forbidden: You do not have permission to test this server" });
		}

		const serverUrl = server.server_url;
		if (!serverUrl) {
			return res.status(400).json({ error: "Server URL not configured" });
		}

		// Normalize server_url (remove trailing slash)
		const normalizedUrl = serverUrl.toString().replace(/\/$/, '');

		// Call provider server to get capabilities
		try {
			const response = await fetch(normalizedUrl, {
				method: 'GET',
				headers: buildProviderHeaders({
					'Accept': 'application/json'
				}, server.auth_token),
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

	// POST /api/servers/:id/refresh - Refresh server methods (requires can_manage)
	router.post("/api/servers/:id/refresh", async (req, res) => {
		const user = await requireUser(req, res);
		if (!user) return;

		const serverId = parseInt(req.params.id, 10);
		if (isNaN(serverId)) {
			return res.status(400).json({ error: "Invalid server ID" });
		}

		const server = await queries.selectServerById.get(serverId);
		if (!server) {
			return res.status(404).json({ error: "Server not found" });
		}

		const isAdmin = user.role === 'admin';
		const canManage = server.user_id === user.id || isAdmin;
		if (!canManage) {
			return res.status(403).json({ error: "Forbidden: You do not have permission to refresh this server" });
		}

		const serverUrl = server.server_url;
		if (!serverUrl) {
			return res.status(400).json({ error: "Server URL not configured" });
		}

		// Normalize server_url (remove trailing slash)
		const normalizedUrl = serverUrl.toString().replace(/\/$/, '');

		// Call provider server to get capabilities
		try {
			const response = await fetch(normalizedUrl, {
				method: 'GET',
				headers: buildProviderHeaders({
					'Accept': 'application/json'
				}, server.auth_token),
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

			// Update server config in database
			const updateResult = await queries.updateServerConfig.run(serverId, capabilities);

			if (updateResult.changes === 0) {
				return res.status(500).json({
					error: "Failed to update server configuration"
				});
			}

			return res.status(200).json({
				success: true,
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
