import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, "..", "data");
// Jest runs test files in parallel across workers. Use a per-worker DB file
// to avoid cross-test interference and "readonly database" errors.
const workerId = String(process.env.JEST_WORKER_ID || "");
const dbFileName = workerId ? `app_${workerId}.db` : "app.db";
const dbPath = path.join(dataDir, dbFileName);

// Dynamically import better-sqlite3 only when needed (not in production/Vercel)
let Database;
async function loadDatabase() {
	if (!Database) {
		Database = (await import("better-sqlite3")).default;
	}
	return Database;
}

function ensureDataDir() {
	if (!fs.existsSync(dataDir)) {
		fs.mkdirSync(dataDir, { recursive: true });
	}
}

function initSchema(db) {
	const schemaPath = path.join(__dirname, "..", "schemas", "sqlite_01.sql");
	const schemaSql = fs.readFileSync(schemaPath, "utf8");
	db.exec(schemaSql);
}

function ensureServersAuthTokenColumn(db) {
	try {
		const columns = db.prepare("PRAGMA table_info(servers)").all();
		const hasAuthToken = columns.some((column) => column.name === "auth_token");
		if (!hasAuthToken) {
			db.exec("ALTER TABLE servers ADD COLUMN auth_token TEXT");
		}
	} catch (error) {
		// console.warn("Failed to ensure auth_token column on servers:", error);
	}
}

function ensureUsersLastActiveAtColumn(db) {
	try {
		const columns = db.prepare("PRAGMA table_info(users)").all();
		const hasLastActiveAt = columns.some((column) => column.name === "last_active_at");
		if (!hasLastActiveAt) {
			db.exec("ALTER TABLE users ADD COLUMN last_active_at TEXT");
		}
	} catch (error) {
		// console.warn("Failed to ensure last_active_at column on users:", error);
	}
}

function ensureUsersMetaColumn(db) {
	try {
		const columns = db.prepare("PRAGMA table_info(users)").all();
		const hasMeta = columns.some((column) => column.name === "meta");
		if (!hasMeta) {
			db.exec("ALTER TABLE users ADD COLUMN meta TEXT");
		}
	} catch (error) {
		// console.warn("Failed to ensure meta column on users:", error);
	}
}

function ensureCreatedImagesMetaColumn(db) {
	try {
		const columns = db.prepare("PRAGMA table_info(created_images)").all();
		const hasMeta = columns.some((column) => column.name === "meta");
		if (!hasMeta) {
			db.exec("ALTER TABLE created_images ADD COLUMN meta TEXT");
		}
	} catch (error) {
		// console.warn("Failed to ensure meta column on created_images:", error);
	}
}

function ensureCreatedImagesUnavailableAtColumn(db) {
	try {
		const columns = db.prepare("PRAGMA table_info(created_images)").all();
		const hasUnavailableAt = columns.some((column) => column.name === "unavailable_at");
		if (!hasUnavailableAt) {
			db.exec("ALTER TABLE created_images ADD COLUMN unavailable_at TEXT");
		}
	} catch (error) {
		// console.warn("Failed to ensure unavailable_at column on created_images:", error);
	}
}

function ensureCreatedImagesAnonPromptColumn(db) {
	try {
		const columns = db.prepare("PRAGMA table_info(created_images_anon)").all();
		const hasPrompt = columns.some((column) => column.name === "prompt");
		if (!hasPrompt) {
			db.exec("ALTER TABLE created_images_anon ADD COLUMN prompt TEXT");
		}
	} catch (error) {
		// ignore
	}
}

function ensureCreatedImagesAnonDroppedAnonCidAndColor(db) {
	try {
		let columns = db.prepare("PRAGMA table_info(created_images_anon)").all();
		if (columns.some((c) => c.name === "anon_cid")) {
			db.exec("ALTER TABLE created_images_anon DROP COLUMN anon_cid");
			columns = db.prepare("PRAGMA table_info(created_images_anon)").all();
		}
		if (columns.some((c) => c.name === "color")) {
			db.exec("ALTER TABLE created_images_anon DROP COLUMN color");
		}
	} catch (error) {
		// ignore (e.g. SQLite < 3.35 without DROP COLUMN)
	}
}

function ensureCreatedImagesAnonDroppedTransitionedToUserId(db) {
	try {
		const columns = db.prepare("PRAGMA table_info(created_images_anon)").all();
		if (columns.some((c) => c.name === "transitioned_to_user_id")) {
			db.exec("ALTER TABLE created_images_anon DROP COLUMN transitioned_to_user_id");
		}
	} catch (error) {
		// ignore (e.g. SQLite < 3.35 without DROP COLUMN)
	}
}

function ensureTryRequestsMetaColumn(db) {
	try {
		const columns = db.prepare("PRAGMA table_info(try_requests)").all();
		if (!columns.some((c) => c.name === "meta")) {
			db.exec("ALTER TABLE try_requests ADD COLUMN meta TEXT");
		}
	} catch (error) {
		// ignore
	}
}

/** Make created_image_anon_id nullable so we can set NULL when image is transitioned to a user. */
function ensureTryRequestsCreatedImageAnonIdNullable(db) {
	try {
		const info = db.prepare("PRAGMA table_info(try_requests)").all();
		const col = info.find((c) => c.name === "created_image_anon_id");
		if (!col) return;
		if (col.notnull === 0) return; // already nullable
		db.exec(`CREATE TABLE try_requests_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anon_cid TEXT NOT NULL,
      prompt TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      fulfilled_at TEXT,
      created_image_anon_id INTEGER NULL,
      meta TEXT,
      FOREIGN KEY (created_image_anon_id) REFERENCES created_images_anon(id)
    )`);
		db.exec("INSERT INTO try_requests_new (id, anon_cid, prompt, created_at, fulfilled_at, created_image_anon_id, meta) SELECT id, anon_cid, prompt, created_at, fulfilled_at, created_image_anon_id, meta FROM try_requests");
		db.exec("DROP TABLE try_requests");
		db.exec("ALTER TABLE try_requests_new RENAME TO try_requests");
		db.exec("CREATE INDEX IF NOT EXISTS idx_try_requests_anon_cid ON try_requests(anon_cid)");
		db.exec("CREATE INDEX IF NOT EXISTS idx_try_requests_created_image_anon_id ON try_requests(created_image_anon_id)");
	} catch (error) {
		// ignore (e.g. already migrated)
	}
}

function parseUserMeta(value) {
	if (value == null) return {};
	if (typeof value === "object") return value;
	if (typeof value !== "string" || !value.trim()) return {};
	try {
		return JSON.parse(value);
	} catch {
		return {};
	}
}

export async function openDb() {
	const DbClass = await loadDatabase();
	ensureDataDir();
	const db = new DbClass(dbPath);
	initSchema(db);
	ensureServersAuthTokenColumn(db);
	ensureUsersLastActiveAtColumn(db);
	ensureUsersMetaColumn(db);
	ensureCreatedImagesMetaColumn(db);
	ensureCreatedImagesUnavailableAtColumn(db);
	ensureCreatedImagesAnonPromptColumn(db);
	ensureCreatedImagesAnonDroppedAnonCidAndColor(db);
	ensureCreatedImagesAnonDroppedTransitionedToUserId(db);
	ensureTryRequestsMetaColumn(db);
	ensureTryRequestsCreatedImageAnonIdNullable(db);

	const transferCreditsTxn = db.transaction((fromUserId, toUserId, amount) => {
		const ensureCreditsRowStmt = db.prepare(
			`INSERT OR IGNORE INTO user_credits (user_id, balance, last_daily_claim_at)
       VALUES (?, 0, NULL)`
		);
		const selectBalanceStmt = db.prepare(
			`SELECT balance FROM user_credits WHERE user_id = ?`
		);
		const debitStmt = db.prepare(
			`UPDATE user_credits
       SET balance = balance - ?, updated_at = datetime('now')
       WHERE user_id = ?`
		);
		const creditStmt = db.prepare(
			`UPDATE user_credits
       SET balance = balance + ?, updated_at = datetime('now')
       WHERE user_id = ?`
		);

		ensureCreditsRowStmt.run(fromUserId);
		ensureCreditsRowStmt.run(toUserId);

		const fromRow = selectBalanceStmt.get(fromUserId);
		const toRow = selectBalanceStmt.get(toUserId);
		const fromBalance = Number(fromRow?.balance ?? 0);
		const toBalance = Number(toRow?.balance ?? 0);

		if (!Number.isFinite(fromBalance) || !Number.isFinite(toBalance)) {
			const err = new Error("Invalid credits balance");
			err.code = "INVALID_BALANCE";
			throw err;
		}

		if (fromBalance < amount) {
			const err = new Error("Insufficient credits");
			err.code = "INSUFFICIENT_CREDITS";
			throw err;
		}

		debitStmt.run(amount, fromUserId);
		creditStmt.run(amount, toUserId);

		const nextFrom = selectBalanceStmt.get(fromUserId);
		const nextTo = selectBalanceStmt.get(toUserId);
		return {
			fromBalance: Number(nextFrom?.balance ?? 0),
			toBalance: Number(nextTo?.balance ?? 0)
		};
	});

	const deleteUserAndCleanupTxn = db.transaction((rawUserId) => {
		const userId = Number(rawUserId);
		if (!Number.isFinite(userId) || userId <= 0) {
			const err = new Error("Invalid user id");
			err.code = "INVALID_USER_ID";
			throw err;
		}

		const changes = {};
		const run = (sql, ...params) => {
			const stmt = db.prepare(sql);
			const result = stmt.run(...params);
			return Number(result?.changes ?? 0);
		};

		// Clean up content that references the user's created images
		changes.feed_items_for_user_images = run(
			`DELETE FROM feed_items
       WHERE created_image_id IN (SELECT id FROM created_images WHERE user_id = ?)`,
			userId
		);
		changes.likes_on_user_images = run(
			`DELETE FROM likes_created_image
       WHERE created_image_id IN (SELECT id FROM created_images WHERE user_id = ?)`,
			userId
		);
		changes.comments_on_user_images = run(
			`DELETE FROM comments_created_image
       WHERE created_image_id IN (SELECT id FROM created_images WHERE user_id = ?)`,
			userId
		);

		// Tip activity linked to the user's created images
		changes.tips_on_user_images = run(
			`DELETE FROM tip_activity
       WHERE created_image_id IN (SELECT id FROM created_images WHERE user_id = ?)`,
			userId
		);

		// Clean up user's interactions on other content
		changes.likes_by_user = run(`DELETE FROM likes_created_image WHERE user_id = ?`, userId);
		changes.comments_by_user = run(`DELETE FROM comments_created_image WHERE user_id = ?`, userId);

		// Tips sent or received by this user
		changes.tips_by_user = run(
			`DELETE FROM tip_activity WHERE from_user_id = ? OR to_user_id = ?`,
			userId,
			userId
		);

		// User-owned content
		changes.created_images = run(`DELETE FROM created_images WHERE user_id = ?`, userId);
		changes.creations = run(`DELETE FROM creations WHERE user_id = ?`, userId);

		// Server ownership and membership
		changes.server_memberships = run(`DELETE FROM server_members WHERE user_id = ?`, userId);
		changes.servers_owned = run(`DELETE FROM servers WHERE user_id = ?`, userId);

		// Notifications and sessions/credits
		changes.notifications = run(`DELETE FROM notifications WHERE user_id = ?`, userId);
		changes.sessions = run(`DELETE FROM sessions WHERE user_id = ?`, userId);
		changes.user_credits = run(`DELETE FROM user_credits WHERE user_id = ?`, userId);

		// Email sends and link clicks (email_link_clicks references email_sends)
		changes.email_link_clicks = run(
			`DELETE FROM email_link_clicks WHERE email_send_id IN (SELECT id FROM email_sends WHERE user_id = ?)`,
			userId
		);
		changes.email_sends = run(`DELETE FROM email_sends WHERE user_id = ?`, userId);
		changes.email_user_campaign_state = run(`DELETE FROM email_user_campaign_state WHERE user_id = ?`, userId);

		// Social graph + profile
		changes.user_follows = run(
			`DELETE FROM user_follows WHERE follower_id = ? OR following_id = ?`,
			userId,
			userId
		);
		changes.user_profile = run(`DELETE FROM user_profiles WHERE user_id = ?`, userId);

		// Finally: delete the user row
		changes.user = run(`DELETE FROM users WHERE id = ?`, userId);

		return { changes };
	});

	const queries = {
		selectUserByEmail: {
			get: async (email) => {
				const stmt = db.prepare(
					"SELECT id, email, password_hash, role, meta FROM users WHERE email = ?"
				);
				const row = stmt.get(email);
				if (!row) return undefined;
				const meta = parseUserMeta(row.meta);
				return { ...row, meta, suspended: meta.suspended === true };
			}
		},
		selectUserById: {
			get: async (id) => {
				const stmt = db.prepare(
					"SELECT id, email, role, created_at, meta FROM users WHERE id = ?"
				);
				const row = stmt.get(id);
				if (!row) return undefined;
				const meta = parseUserMeta(row.meta);
				return { ...row, meta, suspended: meta.suspended === true };
			}
		},
		selectUserByIdForLogin: {
			get: async (id) => {
				const stmt = db.prepare(
					"SELECT id, password_hash, meta FROM users WHERE id = ?"
				);
				const row = stmt.get(id);
				if (!row) return undefined;
				const meta = parseUserMeta(row.meta);
				return { ...row, meta, suspended: meta.suspended === true };
			}
		},
		selectUserByStripeSubscriptionId: {
			get: async (subscriptionId) => {
				if (subscriptionId == null || String(subscriptionId).trim() === "") return undefined;
				const stmt = db.prepare(
					"SELECT id, email, role, created_at, meta FROM users WHERE json_extract(meta, '$.stripeSubscriptionId') = ?"
				);
				const row = stmt.get(String(subscriptionId));
				if (!row) return undefined;
				const meta = parseUserMeta(row.meta);
				return { ...row, meta, suspended: meta.suspended === true };
			}
		},
		selectUserProfileByUserId: {
			get: async (userId) => {
				const stmt = db.prepare(
					`SELECT user_id, user_name, display_name, about, socials, avatar_url, cover_image_url, badges, meta, created_at, updated_at
           FROM user_profiles
           WHERE user_id = ?`
				);
				return Promise.resolve(stmt.get(userId));
			}
		},
		selectUserProfileByUsername: {
			get: async (username) => {
				const stmt = db.prepare(
					`SELECT user_id, user_name, meta
           FROM user_profiles
           WHERE user_name = ?`
				);
				return Promise.resolve(stmt.get(username));
			}
		},
		upsertUserProfile: {
			run: async (userId, profile) => {
				const toJsonText = (value) => {
					if (value == null) return null;
					if (typeof value === "string") return value;
					try {
						return JSON.stringify(value);
					} catch {
						return null;
					}
				};

				const stmt = db.prepare(
					`INSERT INTO user_profiles (
            user_id,
            user_name,
            display_name,
            about,
            socials,
            avatar_url,
            cover_image_url,
            badges,
            meta,
            created_at,
            updated_at
          ) VALUES (
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            ?,
            datetime('now'),
            datetime('now')
          )
          ON CONFLICT(user_id) DO UPDATE SET
            user_name = excluded.user_name,
            display_name = excluded.display_name,
            about = excluded.about,
            socials = excluded.socials,
            avatar_url = excluded.avatar_url,
            cover_image_url = excluded.cover_image_url,
            badges = excluded.badges,
            meta = excluded.meta,
            updated_at = datetime('now')`
				);

				const result = stmt.run(
					userId,
					profile?.user_name ?? null,
					profile?.display_name ?? null,
					profile?.about ?? null,
					toJsonText(profile?.socials),
					profile?.avatar_url ?? null,
					profile?.cover_image_url ?? null,
					toJsonText(profile?.badges),
					toJsonText(profile?.meta)
				);
				return Promise.resolve({ changes: result.changes });
			}
		},
		insertUserFollow: {
			run: async (followerId, followingId) => {
				const stmt = db.prepare(
					`INSERT OR IGNORE INTO user_follows (follower_id, following_id)
           VALUES (?, ?)`
				);
				const result = stmt.run(followerId, followingId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		deleteUserFollow: {
			run: async (followerId, followingId) => {
				const stmt = db.prepare(
					`DELETE FROM user_follows
           WHERE follower_id = ? AND following_id = ?`
				);
				const result = stmt.run(followerId, followingId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		selectUserFollowStatus: {
			get: async (followerId, followingId) => {
				const stmt = db.prepare(
					`SELECT 1 AS viewer_follows
           FROM user_follows
           WHERE follower_id = ? AND following_id = ?
           LIMIT 1`
				);
				return Promise.resolve(stmt.get(followerId, followingId));
			}
		},
		selectUserFollowers: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const stmt = db.prepare(
					`SELECT
            uf.follower_id AS user_id,
            uf.created_at AS followed_at,
            up.user_name,
            up.display_name,
            up.avatar_url
           FROM user_follows uf
           LEFT JOIN user_profiles up ON up.user_id = uf.follower_id
           WHERE uf.following_id = ?
           ORDER BY uf.created_at DESC
           LIMIT ? OFFSET ?`
				);
				return Promise.resolve(stmt.all(userId, limit, offset));
			}
		},
		/** Like selectUserFollowers but adds viewer_follows (1 if viewer follows this follower). */
		selectUserFollowersWithViewer: {
			all: async (targetUserId, viewerId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const stmt = db.prepare(
					`SELECT
            uf.follower_id AS user_id,
            uf.created_at AS followed_at,
            up.user_name,
            up.display_name,
            up.avatar_url,
            (SELECT 1 FROM user_follows uf2 WHERE uf2.follower_id = ? AND uf2.following_id = uf.follower_id LIMIT 1) AS viewer_follows
           FROM user_follows uf
           LEFT JOIN user_profiles up ON up.user_id = uf.follower_id
           WHERE uf.following_id = ?
           ORDER BY uf.created_at DESC
           LIMIT ? OFFSET ?`
				);
				const rows = await Promise.resolve(stmt.all(viewerId, targetUserId, limit, offset));
				return rows.map((r) => ({ ...r, viewer_follows: r?.viewer_follows === 1 }));
			}
		},
		selectUserFollowing: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const stmt = db.prepare(
					`SELECT
            uf.following_id AS user_id,
            uf.created_at AS followed_at,
            up.user_name,
            up.display_name,
            up.avatar_url
           FROM user_follows uf
           LEFT JOIN user_profiles up ON up.user_id = uf.following_id
           WHERE uf.follower_id = ?
           ORDER BY uf.created_at DESC
           LIMIT ? OFFSET ?`
				);
				return Promise.resolve(stmt.all(userId, limit, offset));
			}
		},
		selectSessionByTokenHash: {
			get: async (tokenHash, userId) => {
				const stmt = db.prepare(
					`SELECT id, user_id, token_hash, expires_at
           FROM sessions
           WHERE token_hash = ? AND user_id = ?`
				);
				return Promise.resolve(stmt.get(tokenHash, userId));
			}
		},
		insertUser: {
			run: async (email, password_hash, role) => {
				const stmt = db.prepare(
					"INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)"
				);
				const result = stmt.run(email, password_hash, role);
				// Standardize return value: use insertId (also support lastInsertRowid for backward compat)
				return Promise.resolve({
					insertId: result.lastInsertRowid,
					lastInsertRowid: result.lastInsertRowid,
					changes: result.changes
				});
			}
		},
		insertSession: {
			run: async (userId, tokenHash, expiresAt) => {
				const stmt = db.prepare(
					`INSERT INTO sessions (user_id, token_hash, expires_at)
           VALUES (?, ?, ?)`
				);
				const result = stmt.run(userId, tokenHash, expiresAt);
				return Promise.resolve({
					insertId: result.lastInsertRowid,
					lastInsertRowid: result.lastInsertRowid,
					changes: result.changes
				});
			}
		},
		refreshSessionExpiry: {
			run: async (id, expiresAt) => {
				const stmt = db.prepare(
					`UPDATE sessions
           SET expires_at = ?
           WHERE id = ?`
				);
				const result = stmt.run(expiresAt, id);
				return Promise.resolve({ changes: result.changes });
			}
		},
		deleteSessionByTokenHash: {
			run: async (tokenHash, userId) => {
				if (userId) {
					const stmt = db.prepare(
						`DELETE FROM sessions
             WHERE token_hash = ? AND user_id = ?`
					);
					const result = stmt.run(tokenHash, userId);
					return Promise.resolve({ changes: result.changes });
				}
				const stmt = db.prepare("DELETE FROM sessions WHERE token_hash = ?");
				const result = stmt.run(tokenHash);
				return Promise.resolve({ changes: result.changes });
			}
		},
		deleteExpiredSessions: {
			run: async (nowIso) => {
				const stmt = db.prepare(
					`DELETE FROM sessions
           WHERE expires_at <= ?`
				);
				const result = stmt.run(nowIso);
				return Promise.resolve({ changes: result.changes });
			}
		},
		selectUsers: {
			all: async () => {
				const stmt = db.prepare(
					`SELECT u.id,
            u.email,
            u.role,
            u.created_at,
            u.last_active_at,
            u.meta,
            up.user_name,
            up.display_name,
            up.avatar_url
           FROM users u
           LEFT JOIN user_profiles up ON up.user_id = u.id
           ORDER BY u.id ASC`
				);
				const rows = stmt.all();
				return rows.map((row) => {
					const meta = parseUserMeta(row.meta);
					return {
						...row,
						meta,
						suspended: meta.suspended === true
					};
				});
			}
		},
		updateUserSuspended: {
			run: async (userId, suspended) => {
				const stmt = db.prepare("SELECT meta FROM users WHERE id = ?");
				const row = stmt.get(userId);
				const existing = parseUserMeta(row?.meta);
				const meta = { ...existing, suspended: Boolean(suspended) };
				const updateStmt = db.prepare("UPDATE users SET meta = ? WHERE id = ?");
				const result = updateStmt.run(JSON.stringify(meta), userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		updateUserPlan: {
			run: async (userId, plan) => {
				const stmt = db.prepare("SELECT meta FROM users WHERE id = ?");
				const row = stmt.get(userId);
				const existing = parseUserMeta(row?.meta);
				const meta = { ...existing, plan: plan === "founder" ? "founder" : "free" };
				if (plan === "founder") {
					delete meta.pendingCheckoutSessionId;
					delete meta.pendingCheckoutReturnedAt;
				}
				const updateStmt = db.prepare("UPDATE users SET meta = ? WHERE id = ?");
				const result = updateStmt.run(JSON.stringify(meta), userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		recordCheckoutReturn: {
			run: async (userId, sessionId, returnedAt) => {
				const stmt = db.prepare("SELECT meta FROM users WHERE id = ?");
				const row = stmt.get(userId);
				const existing = parseUserMeta(row?.meta);
				const meta = {
					...existing,
					pendingCheckoutSessionId: sessionId,
					pendingCheckoutReturnedAt: returnedAt
				};
				const updateStmt = db.prepare("UPDATE users SET meta = ? WHERE id = ?");
				const result = updateStmt.run(JSON.stringify(meta), userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		updateUserStripeSubscriptionId: {
			run: async (userId, subscriptionId) => {
				const stmt = db.prepare("SELECT meta FROM users WHERE id = ?");
				const row = stmt.get(userId);
				const existing = parseUserMeta(row?.meta);
				const meta = { ...existing };
				if (subscriptionId != null) {
					meta.stripeSubscriptionId = subscriptionId;
					delete meta.pendingCheckoutSessionId;
					delete meta.pendingCheckoutReturnedAt;
				} else {
					delete meta.stripeSubscriptionId;
					delete meta.pendingCheckoutSessionId;
					delete meta.pendingCheckoutReturnedAt;
				}
				const updateStmt = db.prepare("UPDATE users SET meta = ? WHERE id = ?");
				const result = updateStmt.run(JSON.stringify(meta), userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		updateUserLastActive: {
			run: async (userId) => {
				const stmt = db.prepare(
					`UPDATE users SET last_active_at = datetime('now')
					 WHERE id = ? AND (last_active_at IS NULL OR last_active_at < datetime('now', '-15 minutes'))`
				);
				const result = stmt.run(userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		setPasswordResetToken: {
			run: async (userId, tokenHash, expiresAt) => {
				const stmt = db.prepare("SELECT meta FROM users WHERE id = ?");
				const row = stmt.get(userId);
				const existing = parseUserMeta(row?.meta);
				const meta = { ...existing, reset_token_hash: tokenHash, reset_token_expires_at: expiresAt };
				const updateStmt = db.prepare("UPDATE users SET meta = ? WHERE id = ?");
				const result = updateStmt.run(JSON.stringify(meta), userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		selectUserByResetTokenHash: {
			get: async (tokenHash) => {
				const stmt = db.prepare(
					"SELECT id, email, password_hash, role, meta FROM users WHERE json_extract(meta, '$.reset_token_hash') = ?"
				);
				const row = stmt.get(tokenHash);
				if (!row) return undefined;
				const meta = parseUserMeta(row.meta);
				return { ...row, meta, suspended: meta.suspended === true };
			}
		},
		clearPasswordResetToken: {
			run: async (userId) => {
				const stmt = db.prepare("SELECT meta FROM users WHERE id = ?");
				const row = stmt.get(userId);
				const existing = parseUserMeta(row?.meta);
				const meta = { ...existing };
				delete meta.reset_token_hash;
				delete meta.reset_token_expires_at;
				const updateStmt = db.prepare("UPDATE users SET meta = ? WHERE id = ?");
				const result = updateStmt.run(JSON.stringify(meta), userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		updateUserPassword: {
			run: async (userId, passwordHash) => {
				const stmt = db.prepare("UPDATE users SET password_hash = ? WHERE id = ?");
				const result = stmt.run(passwordHash, userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		updateUserEmail: {
			run: async (userId, newEmail) => {
				const normalized = String(newEmail).trim().toLowerCase();
				const stmt = db.prepare("UPDATE users SET email = ? WHERE id = ?");
				const result = stmt.run(normalized, userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		selectModerationQueue: {
			all: async () => {
				const stmt = db.prepare(
					`SELECT id, content_type, content_id, status, reason, created_at
           FROM moderation_queue
           ORDER BY created_at DESC`
				);
				return Promise.resolve(stmt.all());
			}
		},
		selectProviders: {
			all: async () => {
				const stmt = db.prepare(
					`SELECT 
            ps.id, 
            ps.user_id, 
            ps.name, 
            ps.status, 
            ps.server_url,
            ps.auth_token,
            ps.status_date,
            ps.description,
            ps.members_count,
            ps.server_config,
            ps.created_at,
            ps.updated_at,
            u.email as owner_email
           FROM servers ps
           LEFT JOIN users u ON ps.user_id = u.id
           ORDER BY ps.name ASC`
				);
				const results = stmt.all();
				// Parse JSON for server_config in SQLite
				return results.map(row => {
					let serverConfig = null;
					if (row.server_config) {
						try {
							serverConfig = JSON.parse(row.server_config);
						} catch (e) {
							// console.warn(`Failed to parse server_config for server ${row.id}:`, e);
							serverConfig = null;
						}
					}
					return {
						...row,
						server_config: serverConfig
					};
				});
			}
		},
		insertProvider: {
			run: async (userId, name, status, serverUrl, serverConfig = null, authToken = null) => {
				const stmt = db.prepare(
					`INSERT INTO servers (user_id, name, status, server_url, server_config, auth_token)
           VALUES (?, ?, ?, ?, ?, ?)`
				);
				const resolvedAuthToken = typeof authToken === "string" && authToken.trim()
					? authToken.trim()
					: null;
				const configJson = serverConfig ? JSON.stringify(serverConfig) : null;
				const result = stmt.run(userId, name, status, serverUrl, configJson, resolvedAuthToken);
				return Promise.resolve({
					insertId: result.lastInsertRowid,
					changes: result.changes
				});
			}
		},
		selectPolicies: {
			all: async () => {
				const stmt = db.prepare(
					`SELECT id, key, value, description, updated_at
           FROM policy_knobs
           ORDER BY key ASC`
				);
				return Promise.resolve(stmt.all());
			}
		},
		selectPolicyByKey: {
			get: async (key) => {
				const stmt = db.prepare(
					`SELECT id, key, value, description, updated_at
           FROM policy_knobs
           WHERE key = ?
           LIMIT 1`
				);
				return Promise.resolve(stmt.get(key));
			}
		},
		upsertPolicyKey: {
			run: async (key, value, description) => {
				const updateStmt = db.prepare(
					`UPDATE policy_knobs
           SET value = ?, description = ?, updated_at = datetime('now')
           WHERE key = ?`
				);
				const result = updateStmt.run(value, description ?? null, key);
				if (result.changes > 0) return { changes: result.changes };
				const insertStmt = db.prepare(
					`INSERT INTO policy_knobs (key, value, description, updated_at)
           VALUES (?, ?, ?, datetime('now'))`
				);
				insertStmt.run(key, value, description ?? null);
				return { changes: 1 };
			}
		},
		getRelatedParams: {
			get: async () => {
				const { RELATED_PARAM_DEFAULTS, RELATED_PARAM_KEYS } = await import("./relatedParams.js");
				const stmt = db.prepare(
					`SELECT key, value FROM policy_knobs WHERE key LIKE 'related.%'`
				);
				const rows = stmt.all();
				const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));
				const out = { ...RELATED_PARAM_DEFAULTS };
				for (const key of RELATED_PARAM_KEYS) {
					if (byKey[key] !== undefined) out[key] = byKey[key];
				}
				return out;
			}
		},
		recordTransition: {
			run: async () => ({ changes: 1 })
		},
		selectTransitions: {
			list: async () => ({
				items: [],
				total: 0,
				page: 1,
				limit: 20,
				hasMore: false
			})
		},
		selectRelatedToCreatedImage: {
			all: async () => ({ ids: [], hasMore: false })
		},
		selectNotificationsForUser: {
			all: async (userId, role) => {
				const stmt = db.prepare(
					`SELECT id, title, message, link, created_at, acknowledged_at,
            actor_user_id, type, target, meta
           FROM notifications
           WHERE (user_id = ? OR role = ?)
           ORDER BY created_at DESC`
				);
				return Promise.resolve(stmt.all(userId, role));
			}
		},
		selectNotificationById: {
			get: async (id, userId, role) => {
				const stmt = db.prepare(
					`SELECT id, title, message, link, created_at, acknowledged_at,
            actor_user_id, type, target, meta
           FROM notifications
           WHERE id = ? AND (user_id = ? OR role = ?)`
				);
				return Promise.resolve(stmt.get(id, userId, role));
			}
		},
		acknowledgeNotificationsForUserAndCreation: {
			run: async (userId, role, creationId) => {
				const linkPattern = `/creations/${creationId}`;
				const stmt = db.prepare(
					`UPDATE notifications
           SET acknowledged_at = datetime('now')
           WHERE acknowledged_at IS NULL
           AND (user_id = ? OR role = ?)
           AND link = ?`
				);
				const result = stmt.run(userId, role, linkPattern);
				return Promise.resolve({ changes: result.changes });
			}
		},
		selectUnreadNotificationCount: {
			get: async (userId, role) => {
				const stmt = db.prepare(
					`SELECT COUNT(*) AS count
           FROM notifications
           WHERE acknowledged_at IS NULL
           AND (user_id = ? OR role = ?)`
				);
				return Promise.resolve(stmt.get(userId, role));
			}
		},
		acknowledgeNotificationById: {
			run: async (id, userId, role) => {
				const stmt = db.prepare(
					`UPDATE notifications
           SET acknowledged_at = datetime('now')
           WHERE id = ?
           AND acknowledged_at IS NULL
           AND (user_id = ? OR role = ?)`
				);
				const result = stmt.run(id, userId, role);
				return Promise.resolve({ changes: result.changes });
			}
		},
		updateNotificationAcknowledgedAtById: {
			run: async (id) => {
				const stmt = db.prepare(
					`UPDATE notifications SET acknowledged_at = datetime('now') WHERE id = ? AND acknowledged_at IS NULL`
				);
				const result = stmt.run(id);
				return Promise.resolve({ changes: result.changes });
			}
		},
		acknowledgeAllNotificationsForUser: {
			run: async (userId, role) => {
				const stmt = db.prepare(
					`UPDATE notifications
           SET acknowledged_at = datetime('now')
           WHERE acknowledged_at IS NULL
           AND (user_id = ? OR role = ?)`
				);
				const result = stmt.run(userId, role);
				return Promise.resolve({ changes: result.changes });
			}
		},
		insertNotification: {
			run: async (userId, role, title, message, link, actor_user_id, type, target, meta) => {
				const stmt = db.prepare(
					`INSERT INTO notifications (user_id, role, title, message, link, actor_user_id, type, target, meta)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
				);
				const metaText = meta != null && typeof meta !== "string" ? JSON.stringify(meta) : (meta ?? null);
				const targetText = target != null && typeof target !== "string" ? JSON.stringify(target) : (target ?? null);
				const result = stmt.run(
					userId ?? null,
					role ?? null,
					title,
					message,
					link ?? null,
					actor_user_id ?? null,
					type ?? null,
					targetText,
					metaText
				);
				return Promise.resolve({
					insertId: result.lastInsertRowid,
					lastInsertRowid: result.lastInsertRowid,
					changes: result.changes
				});
			}
		},
		selectDistinctUserIdsWithUnreadNotificationsSince: {
			all: async (sinceIso) => {
				const stmt = db.prepare(
					`SELECT DISTINCT user_id AS user_id
           FROM notifications
           WHERE user_id IS NOT NULL AND acknowledged_at IS NULL AND created_at >= ?`
				);
				const rows = stmt.all(sinceIso);
				return Promise.resolve(rows ?? []);
			}
		},
		insertEmailSend: {
			run: async (userId, campaign, meta) => {
				const stmt = db.prepare(
					`INSERT INTO email_sends (user_id, campaign, created_at, meta)
           VALUES (?, ?, datetime('now'), ?)`
				);
				const result = stmt.run(userId, campaign, meta ?? null);
				return Promise.resolve({
					insertId: result.lastInsertRowid,
					lastInsertRowid: result.lastInsertRowid,
					changes: result.changes
				});
			}
		},
		selectUserEmailCampaignState: {
			get: async (userId) => {
				const stmt = db.prepare(
					`SELECT user_id, last_digest_sent_at, welcome_email_sent_at,
            first_creation_nudge_sent_at, last_reengagement_sent_at, last_creation_highlight_sent_at, updated_at, meta
           FROM email_user_campaign_state WHERE user_id = ?`
				);
				return Promise.resolve(stmt.get(userId));
			}
		},
		upsertUserEmailCampaignStateLastDigest: {
			run: async (userId, sentAtIso) => {
				const stmt = db.prepare(
					`INSERT INTO email_user_campaign_state (user_id, last_digest_sent_at, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT (user_id) DO UPDATE SET
             last_digest_sent_at = excluded.last_digest_sent_at,
             updated_at = datetime('now')`
				);
				const result = stmt.run(userId, sentAtIso);
				return Promise.resolve({ changes: result.changes });
			}
		},
		upsertUserEmailCampaignStateWelcome: {
			run: async (userId, sentAtIso) => {
				const stmt = db.prepare(
					`INSERT INTO email_user_campaign_state (user_id, welcome_email_sent_at, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT (user_id) DO UPDATE SET
             welcome_email_sent_at = excluded.welcome_email_sent_at,
             updated_at = datetime('now')`
				);
				const result = stmt.run(userId, sentAtIso);
				return Promise.resolve({ changes: result.changes });
			}
		},
		upsertUserEmailCampaignStateFirstCreationNudge: {
			run: async (userId, sentAtIso) => {
				const stmt = db.prepare(
					`INSERT INTO email_user_campaign_state (user_id, first_creation_nudge_sent_at, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT (user_id) DO UPDATE SET
             first_creation_nudge_sent_at = excluded.first_creation_nudge_sent_at,
             updated_at = datetime('now')`
				);
				const result = stmt.run(userId, sentAtIso);
				return Promise.resolve({ changes: result.changes });
			}
		},
		upsertUserEmailCampaignStateReengagement: {
			run: async (userId, sentAtIso) => {
				const stmt = db.prepare(
					`INSERT INTO email_user_campaign_state (user_id, last_reengagement_sent_at, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT (user_id) DO UPDATE SET
             last_reengagement_sent_at = excluded.last_reengagement_sent_at,
             updated_at = datetime('now')`
				);
				const result = stmt.run(userId, sentAtIso);
				return Promise.resolve({ changes: result.changes });
			}
		},
		upsertUserEmailCampaignStateCreationHighlight: {
			run: async (userId, sentAtIso) => {
				const stmt = db.prepare(
					`INSERT INTO email_user_campaign_state (user_id, last_creation_highlight_sent_at, updated_at)
           VALUES (?, ?, datetime('now'))
           ON CONFLICT (user_id) DO UPDATE SET
             last_creation_highlight_sent_at = excluded.last_creation_highlight_sent_at,
             updated_at = datetime('now')`
				);
				const result = stmt.run(userId, sentAtIso);
				return Promise.resolve({ changes: result.changes });
			}
		},
		selectUsersEligibleForReengagement: {
			// Only users who have already received welcome (so we never send "we miss you" before "welcome")
			all: async (inactiveBeforeIso, lastReengagementBeforeIso) => {
				const stmt = db.prepare(
					`SELECT DISTINCT ci.user_id AS user_id
           FROM created_images ci
           INNER JOIN users u ON u.id = ci.user_id AND TRIM(u.email) != '' AND u.email LIKE '%@%'
           AND (COALESCE(u.last_active_at, u.created_at) <= datetime(?))
           INNER JOIN email_user_campaign_state s ON s.user_id = ci.user_id
           AND s.welcome_email_sent_at IS NOT NULL
           WHERE (s.last_reengagement_sent_at IS NULL OR datetime(s.last_reengagement_sent_at) <= datetime(?))`
				);
				const rows = stmt.all(inactiveBeforeIso ?? "1970-01-01T00:00:00.000Z", lastReengagementBeforeIso ?? "9999-12-31T23:59:59.999Z") ?? [];
				return Promise.resolve(rows);
			}
		},
		selectCreationsEligibleForHighlight: {
			all: async (sinceIso, highlightSentBeforeIso) => {
				const stmt = db.prepare(
					`SELECT ci.user_id AS user_id, ci.id AS creation_id,
            COALESCE(NULLIF(TRIM(ci.title), ''), 'Untitled') AS title,
            COUNT(c.id) AS comment_count
           FROM comments_created_image c
           INNER JOIN created_images ci ON ci.id = c.created_image_id AND c.created_at >= datetime(?)
           LEFT JOIN email_user_campaign_state s ON s.user_id = ci.user_id
           WHERE (s.last_creation_highlight_sent_at IS NULL OR datetime(s.last_creation_highlight_sent_at) <= datetime(?))
           GROUP BY ci.user_id, ci.id, ci.title
           ORDER BY ci.user_id, comment_count DESC`
				);
				const rows = stmt.all(sinceIso ?? "1970-01-01T00:00:00.000Z", highlightSentBeforeIso ?? "9999-12-31T23:59:59.999Z") ?? [];
				// One row per owner (hottest creation)
				const byOwner = {};
				for (const r of rows) {
					const uid = r?.user_id;
					if (uid == null) continue;
					if (!byOwner[uid] || (r?.comment_count ?? 0) > (byOwner[uid].comment_count ?? 0)) {
						byOwner[uid] = {
							user_id: uid,
							creation_id: r?.creation_id,
							title: r?.title ?? "Untitled",
							comment_count: r?.comment_count ?? 0
						};
					}
				}
				return Promise.resolve(Object.values(byOwner));
			}
		},
		selectUsersEligibleForWelcomeEmail: {
			all: async (createdBeforeIso) => {
				const stmt = db.prepare(
					`SELECT u.id AS user_id FROM users u
           LEFT JOIN email_user_campaign_state s ON s.user_id = u.id
           WHERE TRIM(u.email) != '' AND u.email LIKE '%@%'
           AND (s.welcome_email_sent_at IS NULL OR s.user_id IS NULL)
           AND datetime(u.created_at) <= datetime(?)`
				);
				const rows = stmt.all(createdBeforeIso) ?? [];
				return Promise.resolve(rows);
			}
		},
		selectUsersEligibleForFirstCreationNudge: {
			// welcomeSentBeforeIso: only nudge users who were sent welcome at least this long ago (e.g. now - 24h) so we never send both in the same run
			all: async (welcomeSentBeforeIso) => {
				const stmt = db.prepare(
					`SELECT u.id AS user_id FROM users u
           INNER JOIN email_user_campaign_state s ON s.user_id = u.id
           WHERE TRIM(u.email) != '' AND u.email LIKE '%@%'
           AND s.first_creation_nudge_sent_at IS NULL
           AND s.welcome_email_sent_at IS NOT NULL AND datetime(s.welcome_email_sent_at) <= datetime(?)
           AND NOT EXISTS (SELECT 1 FROM created_images ci WHERE ci.user_id = u.id)`
				);
				const rows = stmt.all(welcomeSentBeforeIso ?? "1970-01-01T00:00:00.000Z") ?? [];
				return Promise.resolve(rows);
			}
		},
		selectEmailSendsCountForUserSince: {
			get: async (userId, campaign, sinceIso) => {
				const stmt = db.prepare(
					`SELECT COUNT(*) AS count
           FROM email_sends
           WHERE user_id = ? AND campaign = ? AND created_at >= ?`
				);
				return Promise.resolve(stmt.get(userId, campaign, sinceIso));
			}
		},
		countEmailSends: {
			get: async () => {
				const row = db.prepare("SELECT COUNT(*) AS count FROM email_sends").get();
				return Promise.resolve({ count: row?.count ?? 0 });
			}
		},
		listEmailSendsRecent: {
			all: async (limit, offset = 0) => {
				const cap = Math.min(Math.max(0, Number(limit) || 200), 500);
				const off = Math.max(0, Number(offset) || 0);
				const stmt = db.prepare(
					`SELECT id, user_id, campaign, created_at, meta
           FROM email_sends
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
				);
				const rows = stmt.all(cap, off) ?? [];
				return Promise.resolve(rows);
			}
		},
		selectDigestActivityByOwnerSince: {
			all: async (ownerUserId, sinceIso) => {
				// Use datetime(?) so ISO 'YYYY-MM-DDTHH:MM:SS.sssZ' compares correctly with SQLite's 'YYYY-MM-DD HH:MM:SS'
				const stmt = db.prepare(
					`SELECT ci.id AS created_image_id, COALESCE(NULLIF(TRIM(ci.title), ''), 'Untitled') AS title, COUNT(c.id) AS comment_count
           FROM created_images ci
           INNER JOIN comments_created_image c ON c.created_image_id = ci.id AND c.created_at >= datetime(?)
           WHERE ci.user_id = ?
           GROUP BY ci.id, ci.title
           ORDER BY comment_count DESC, ci.id`
				);
				const rows = stmt.all(sinceIso, ownerUserId) ?? [];
				return Promise.resolve(rows);
			}
		},
		selectDigestActivityByCommenterSince: {
			all: async (commenterUserId, sinceIso) => {
				const stmt = db.prepare(
					`SELECT ci.id AS created_image_id, COALESCE(NULLIF(TRIM(ci.title), ''), 'Untitled') AS title, COUNT(c.id) AS comment_count
           FROM created_images ci
           INNER JOIN comments_created_image c ON c.created_image_id = ci.id AND c.created_at >= datetime(?) AND c.user_id != ?
           WHERE ci.id IN (SELECT DISTINCT created_image_id FROM comments_created_image WHERE user_id = ?)
           AND ci.user_id != ?
           GROUP BY ci.id, ci.title
           ORDER BY comment_count DESC, ci.id`
				);
				const rows = stmt.all(sinceIso, commenterUserId, commenterUserId, commenterUserId) ?? [];
				return Promise.resolve(rows);
			}
		},
		insertEmailLinkClick: {
			run: async (emailSendId, userId, path) => {
				const stmt = db.prepare(
					`INSERT INTO email_link_clicks (email_send_id, user_id, clicked_at, path)
           VALUES (?, ?, datetime('now'), ?)`
				);
				const result = stmt.run(emailSendId, userId ?? null, path ?? null);
				return Promise.resolve({ changes: result.changes });
			}
		},
		selectExploreFeedItems: {
			all: async (viewerId) => {
				const id = viewerId ?? null;
				if (id === null || id === undefined) {
					return Promise.resolve([]);
				}
				const stmt = db.prepare(
					`SELECT fi.id, fi.title, fi.summary, fi.author, fi.tags, fi.created_at, 
                  fi.created_image_id, ci.filename, ci.file_path, ci.user_id,
                  up.user_name AS author_user_name,
                  up.display_name AS author_display_name,
                  up.avatar_url AS author_avatar_url,
                  COALESCE(ci.file_path, CASE WHEN ci.filename IS NOT NULL THEN '/api/images/created/' || ci.filename ELSE NULL END) as url,
                  COALESCE(lc.like_count, 0) AS like_count,
                  COALESCE(cc.comment_count, 0) AS comment_count,
                  CASE WHEN ? IS NOT NULL AND vl.user_id IS NOT NULL THEN 1 ELSE 0 END AS viewer_liked
           FROM feed_items fi
           LEFT JOIN created_images ci ON fi.created_image_id = ci.id
           LEFT JOIN user_profiles up ON up.user_id = ci.user_id
           LEFT JOIN (
             SELECT created_image_id, COUNT(*) AS like_count
             FROM likes_created_image
             GROUP BY created_image_id
           ) lc ON lc.created_image_id = fi.created_image_id
           LEFT JOIN (
             SELECT created_image_id, COUNT(*) AS comment_count
             FROM comments_created_image
             GROUP BY created_image_id
           ) cc ON cc.created_image_id = fi.created_image_id
           LEFT JOIN likes_created_image vl
             ON vl.created_image_id = fi.created_image_id
            AND vl.user_id = ?
           WHERE ci.user_id IS NOT NULL
             AND ci.user_id != ?
             AND NOT EXISTS (
               SELECT 1
               FROM user_follows uf
               WHERE uf.follower_id = ?
                 AND uf.following_id = ci.user_id
             )
           ORDER BY fi.created_at DESC`
				);
				return Promise.resolve(stmt.all(id, id, id, id));
			},
			paginated: async (viewerId, { limit = 24, offset = 0 } = {}) => {
				const id = viewerId ?? null;
				if (id === null || id === undefined) {
					return Promise.resolve([]);
				}
				// Allow limit+1 (e.g. 101) so API can detect hasMore; cap at 500 for safety
				const lim = Math.min(Math.max(0, Number(limit) || 24), 500);
				const off = Math.max(0, Number(offset) || 0);
				const stmt = db.prepare(
					`SELECT fi.id, fi.title, fi.summary, fi.author, fi.tags, fi.created_at,
                  fi.created_image_id, ci.filename, ci.file_path, ci.user_id,
                  up.user_name AS author_user_name,
                  up.display_name AS author_display_name,
                  up.avatar_url AS author_avatar_url,
                  COALESCE(ci.file_path, CASE WHEN ci.filename IS NOT NULL THEN '/api/images/created/' || ci.filename ELSE NULL END) as url,
                  COALESCE(lc.like_count, 0) AS like_count,
                  COALESCE(cc.comment_count, 0) AS comment_count,
                  CASE WHEN ? IS NOT NULL AND vl.user_id IS NOT NULL THEN 1 ELSE 0 END AS viewer_liked
           FROM feed_items fi
           LEFT JOIN created_images ci ON fi.created_image_id = ci.id
           LEFT JOIN user_profiles up ON up.user_id = ci.user_id
           LEFT JOIN (
             SELECT created_image_id, COUNT(*) AS like_count
             FROM likes_created_image
             GROUP BY created_image_id
           ) lc ON lc.created_image_id = fi.created_image_id
           LEFT JOIN (
             SELECT created_image_id, COUNT(*) AS comment_count
             FROM comments_created_image
             GROUP BY created_image_id
           ) cc ON cc.created_image_id = fi.created_image_id
           LEFT JOIN likes_created_image vl
             ON vl.created_image_id = fi.created_image_id
            AND vl.user_id = ?
           WHERE ci.user_id IS NOT NULL
             AND ci.user_id != ?
             AND NOT EXISTS (
               SELECT 1
               FROM user_follows uf
               WHERE uf.follower_id = ?
                 AND uf.following_id = ci.user_id
             )
           ORDER BY fi.created_at DESC
           LIMIT ? OFFSET ?`
				);
				return Promise.resolve(stmt.all(id, id, id, id, lim, off));
			}
		},
		selectNewestPublishedFeedItems: {
			all: async (userId) => {
				// All published feed items, newest first (no viewer/follow filtering). Used for Advanced create "Newest".
				const stmt = db.prepare(
					`SELECT fi.id, fi.title, fi.summary, fi.author, fi.tags, fi.created_at,
                  fi.created_image_id, ci.filename, ci.file_path, ci.user_id,
                  up.user_name AS author_user_name,
                  up.display_name AS author_display_name,
                  up.avatar_url AS author_avatar_url,
                  COALESCE(ci.file_path, CASE WHEN ci.filename IS NOT NULL THEN '/api/images/created/' || ci.filename ELSE NULL END) as url,
                  COALESCE(lc.like_count, 0) AS like_count,
                  COALESCE(cc.comment_count, 0) AS comment_count,
                  0 AS viewer_liked
           FROM feed_items fi
           LEFT JOIN created_images ci ON fi.created_image_id = ci.id
           LEFT JOIN user_profiles up ON up.user_id = ci.user_id
           LEFT JOIN (
             SELECT created_image_id, COUNT(*) AS like_count
             FROM likes_created_image
             GROUP BY created_image_id
           ) lc ON lc.created_image_id = fi.created_image_id
           LEFT JOIN (
             SELECT created_image_id, COUNT(*) AS comment_count
             FROM comments_created_image
             GROUP BY created_image_id
           ) cc ON cc.created_image_id = fi.created_image_id
           WHERE ci.user_id IS NOT NULL
           ORDER BY fi.created_at DESC`
				);
				return Promise.resolve(stmt.all());
			}
		},
		selectNewbieFeedItems: {
			all: async (viewerId) => {
				const id = viewerId ?? null;
				if (id === null || id === undefined) {
					return Promise.resolve([]);
				}
				const stmt = db.prepare(
					`SELECT fi.id, fi.title, fi.summary, fi.author, fi.tags, fi.created_at,
                  fi.created_image_id, ci.filename, ci.file_path, ci.user_id,
                  up.user_name AS author_user_name,
                  up.display_name AS author_display_name,
                  up.avatar_url AS author_avatar_url,
                  COALESCE(ci.file_path, CASE WHEN ci.filename IS NOT NULL THEN '/api/images/created/' || ci.filename ELSE NULL END) as url,
                  COALESCE(lc.like_count, 0) AS like_count,
                  COALESCE(cc.comment_count, 0) AS comment_count,
                  CASE WHEN ? IS NOT NULL AND vl.user_id IS NOT NULL THEN 1 ELSE 0 END AS viewer_liked
           FROM feed_items fi
           LEFT JOIN created_images ci ON fi.created_image_id = ci.id
           LEFT JOIN user_profiles up ON up.user_id = ci.user_id
           LEFT JOIN (
             SELECT created_image_id, COUNT(*) AS like_count
             FROM likes_created_image
             GROUP BY created_image_id
           ) lc ON lc.created_image_id = fi.created_image_id
           LEFT JOIN (
             SELECT created_image_id, COUNT(*) AS comment_count
             FROM comments_created_image
             GROUP BY created_image_id
           ) cc ON cc.created_image_id = fi.created_image_id
           LEFT JOIN likes_created_image vl
             ON vl.created_image_id = fi.created_image_id
            AND vl.user_id = ?
           WHERE ci.user_id IS NOT NULL
             AND ci.user_id != ?
             AND (COALESCE(lc.like_count, 0) > 0 OR COALESCE(cc.comment_count, 0) > 0)
           ORDER BY fi.created_at DESC`
				);
				return Promise.resolve(stmt.all(id, id, id));
			}
		},
		selectAllCreatedImageIdAndMeta: {
			all: async () => {
				const stmt = db.prepare(`SELECT id, meta FROM created_images`);
				return stmt.all();
			}
		},
		selectFeedItemsByCreationIds: {
			all: async (ids) => {
				const safeIds = Array.isArray(ids)
					? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
					: [];
				if (safeIds.length === 0) return [];
				const placeholders = safeIds.map(() => "?").join(",");
				const stmt = db.prepare(
					`SELECT ci.id, ci.title, ci.description, ci.created_at, ci.user_id,
						ci.filename, ci.file_path,
						COALESCE(lc.like_count, 0) AS like_count,
						COALESCE(cc.comment_count, 0) AS comment_count,
						up.user_name AS author_user_name,
						up.display_name AS author_display_name,
						up.avatar_url AS author_avatar_url
					FROM created_images ci
					LEFT JOIN (
						SELECT created_image_id, COUNT(*) AS like_count
						FROM likes_created_image
						GROUP BY created_image_id
					) lc ON lc.created_image_id = ci.id
					LEFT JOIN (
						SELECT created_image_id, COUNT(*) AS comment_count
						FROM comments_created_image
						GROUP BY created_image_id
					) cc ON cc.created_image_id = ci.id
					LEFT JOIN user_profiles up ON up.user_id = ci.user_id
					WHERE ci.id IN (${placeholders})`
				);
				const rows = stmt.all(...safeIds);
				const orderById = new Map(safeIds.map((id, i) => [id, i]));
				const sorted = (rows ?? []).slice().sort((a, b) => (orderById.get(Number(a.id)) ?? 999) - (orderById.get(Number(b.id)) ?? 999));
				return sorted.map((row) => {
					const summary = row.description ?? "";
					return {
						id: row.id,
						created_image_id: row.id,
						title: row.title ?? "",
						summary,
						created_at: row.created_at,
						user_id: row.user_id,
						like_count: Number(row.like_count ?? 0),
						comment_count: Number(row.comment_count ?? 0),
						author_display_name: row.author_display_name ?? null,
						author_user_name: row.author_user_name ?? null,
						author_avatar_url: row.author_avatar_url ?? null,
						url:
							row.file_path ??
							(row.filename
								? `/api/images/created/${row.filename}`
								: null)
					};
				});
			}
		},
		selectMostMutatedFeedItems: {
			all: async (viewerId, limit) => {
				const limitNum = Number.isFinite(Number(limit)) ? Math.max(0, Math.min(Number(limit), 200)) : 25;
				const rows = db.prepare("SELECT id, meta FROM created_images").all();
				const countById = new Map();
				function toHistoryArray(meta) {
					const h = meta?.history;
					if (Array.isArray(h)) return h;
					if (typeof h === "string") {
						try { const a = JSON.parse(h); return Array.isArray(a) ? a : []; } catch { return []; }
					}
					return [];
				}
				for (const row of rows ?? []) {
					let meta = null;
					try {
						meta = typeof row.meta === "string" ? JSON.parse(row.meta) : row.meta;
					} catch (_) { }
					if (!meta || typeof meta !== "object") continue;
					const history = toHistoryArray(meta);
					for (const v of history) {
						const id = v != null ? Number(v) : NaN;
						if (!Number.isFinite(id) || id <= 0) continue;
						countById.set(id, (countById.get(id) ?? 0) + 1);
					}
					const mid = meta.mutate_of_id != null ? Number(meta.mutate_of_id) : NaN;
					if (Number.isFinite(mid) && mid > 0) countById.set(mid, (countById.get(mid) ?? 0) + 1);
				}
				const topIds = [...countById.entries()]
					.sort((a, b) => (b[1] - a[1]) || (a[0] - b[0]))
					.slice(0, limitNum)
					.map(([id]) => id);
				if (topIds.length === 0) return [];
				const placeholders = topIds.map(() => "?").join(",");
				const detailStmt = db.prepare(
					`SELECT ci.id, ci.title, ci.summary, ci.created_at, ci.user_id,
						COALESCE(lc.like_count, 0) AS like_count,
						COALESCE(cc.comment_count, 0) AS comment_count,
						up.user_name AS author_user_name,
						up.display_name AS author_display_name
					FROM created_images ci
					LEFT JOIN (
						SELECT created_image_id, COUNT(*) AS like_count
						FROM likes_created_image
						GROUP BY created_image_id
					) lc ON lc.created_image_id = ci.id
					LEFT JOIN (
						SELECT created_image_id, COUNT(*) AS comment_count
						FROM comments_created_image
						GROUP BY created_image_id
					) cc ON cc.created_image_id = ci.id
					LEFT JOIN user_profiles up ON up.user_id = ci.user_id
					WHERE ci.id IN (${placeholders})`
				);
				const detailRows = detailStmt.all(...topIds);
				const orderById = new Map(topIds.map((id, i) => [id, i]));
				const sorted = (detailRows ?? []).slice().sort((a, b) => (orderById.get(Number(a.id)) ?? 999) - (orderById.get(Number(b.id)) ?? 999));
				return sorted.map((row) => ({
					id: row.id,
					created_image_id: row.id,
					title: row.title ?? "",
					summary: row.summary ?? "",
					created_at: row.created_at,
					user_id: row.user_id,
					like_count: Number(row.like_count ?? 0),
					comment_count: Number(row.comment_count ?? 0),
					author_display_name: row.author_display_name ?? null,
					author_user_name: row.author_user_name ?? null
				}));
			}
		},
		selectFeedItems: {
			all: async (excludeUserId) => {
				const viewerId = excludeUserId ?? null;
				if (viewerId === null || viewerId === undefined) {
					return Promise.resolve([]);
				}
				const stmt = db.prepare(
					`SELECT fi.id, fi.title, fi.summary, fi.author, fi.tags, fi.created_at, 
                  fi.created_image_id, ci.filename, ci.file_path, ci.user_id,
                  up.user_name AS author_user_name,
                  up.display_name AS author_display_name,
                  up.avatar_url AS author_avatar_url,
                  CASE WHEN json_extract(u.meta,'$.plan') = 'founder' THEN 'founder' ELSE 'free' END AS author_plan,
                  COALESCE(ci.file_path, CASE WHEN ci.filename IS NOT NULL THEN '/api/images/created/' || ci.filename ELSE NULL END) as url,
                  COALESCE(lc.like_count, 0) AS like_count,
                  COALESCE(cc.comment_count, 0) AS comment_count,
                  CASE WHEN ? IS NOT NULL AND vl.user_id IS NOT NULL THEN 1 ELSE 0 END AS viewer_liked
           FROM feed_items fi
           LEFT JOIN created_images ci ON fi.created_image_id = ci.id
           LEFT JOIN user_profiles up ON up.user_id = ci.user_id
           LEFT JOIN users u ON u.id = ci.user_id
           LEFT JOIN (
             SELECT created_image_id, COUNT(*) AS like_count
             FROM likes_created_image
             GROUP BY created_image_id
           ) lc ON lc.created_image_id = fi.created_image_id
           LEFT JOIN (
             SELECT created_image_id, COUNT(*) AS comment_count
             FROM comments_created_image
             GROUP BY created_image_id
           ) cc ON cc.created_image_id = fi.created_image_id
           LEFT JOIN likes_created_image vl
             ON vl.created_image_id = fi.created_image_id
            AND vl.user_id = ?
           WHERE ci.user_id IS NOT NULL
             AND (ci.unavailable_at IS NULL OR ci.unavailable_at = '')
             AND EXISTS (
               SELECT 1
               FROM user_follows uf
               WHERE uf.follower_id = ?
                 AND uf.following_id = ci.user_id
             )
           ORDER BY fi.created_at DESC`
				);
				return Promise.resolve(stmt.all(viewerId, viewerId, viewerId));
			}
		},
		selectExploreItems: {
			all: async () => {
				const stmt = db.prepare(
					`SELECT id, title, summary, category, created_at
           FROM explore_items
           ORDER BY created_at DESC`
				);
				return Promise.resolve(stmt.all());
			}
		},
		selectCreationsForUser: {
			all: async (userId) => {
				const stmt = db.prepare(
					`SELECT id, title, body, status, created_at
           FROM creations
           WHERE user_id = ?
           ORDER BY created_at DESC`
				);
				return Promise.resolve(stmt.all(userId));
			}
		},
		selectServers: {
			all: async () => {
				const stmt = db.prepare(
					`SELECT 
            ps.id, 
            ps.user_id,
            ps.name, 
            ps.status, 
            ps.members_count, 
            ps.description, 
            ps.created_at,
            ps.server_url,
            ps.auth_token,
            ps.status_date,
            ps.server_config,
            u.email as owner_email
           FROM servers ps
           LEFT JOIN users u ON ps.user_id = u.id
           ORDER BY ps.name ASC`
				);
				const results = stmt.all();
				// Parse JSON for server_config in SQLite
				return results.map(row => {
					let serverConfig = null;
					if (row.server_config) {
						try {
							serverConfig = JSON.parse(row.server_config);
						} catch (e) {
							// console.warn(`Failed to parse server_config for server ${row.id}:`, e);
							serverConfig = null;
						}
					}
					return {
						...row,
						server_config: serverConfig
					};
				});
			}
		},
		selectServerById: {
			get: async (serverId) => {
				const stmt = db.prepare(
					`SELECT 
            ps.id, 
            ps.user_id,
            ps.name, 
            ps.status, 
            ps.members_count, 
            ps.description, 
            ps.created_at,
            ps.server_url,
            ps.auth_token,
            ps.status_date,
            ps.server_config,
            u.email as owner_email
           FROM servers ps
           LEFT JOIN users u ON ps.user_id = u.id
           WHERE ps.id = ?`
				);
				const row = stmt.get(serverId);
				if (!row) return null;

				// Parse JSON for server_config in SQLite
				let serverConfig = null;
				if (row.server_config) {
					try {
						serverConfig = JSON.parse(row.server_config);
					} catch (e) {
						// console.warn(`Failed to parse server_config for server ${row.id}:`, e);
						serverConfig = null;
					}
				}
				return {
					...row,
					server_config: serverConfig
				};
			}
		},
		updateServerConfig: {
			run: async (serverId, serverConfig) => {
				const stmt = db.prepare(
					`UPDATE servers 
           SET server_config = ?, updated_at = datetime('now')
           WHERE id = ?`
				);
				const configJson = serverConfig ? JSON.stringify(serverConfig) : null;
				const result = stmt.run(configJson, serverId);
				return Promise.resolve({
					changes: result.changes
				});
			}
		},
		updateServer: {
			run: async (serverId, server) => {
				const stmt = db.prepare(
					`UPDATE servers
           SET user_id = ?,
               name = ?,
               status = ?,
               server_url = ?,
               auth_token = ?,
               status_date = ?,
               description = ?,
               members_count = ?,
               server_config = ?,
               updated_at = datetime('now')
           WHERE id = ?`
				);
				const configJson = server?.server_config ? JSON.stringify(server.server_config) : null;
				const result = stmt.run(
					server?.user_id ?? null,
					server?.name ?? null,
					server?.status ?? null,
					server?.server_url ?? null,
					server?.auth_token ?? null,
					server?.status_date ?? null,
					server?.description ?? null,
					server?.members_count ?? 0,
					configJson,
					serverId
				);
				return Promise.resolve({
					changes: result.changes
				});
			}
		},
		checkServerMembership: {
			get: async (serverId, userId) => {
				const stmt = db.prepare(
					`SELECT 1 FROM server_members WHERE server_id = ? AND user_id = ?`
				);
				const result = stmt.get(serverId, userId);
				return result !== undefined;
			}
		},
		addServerMember: {
			run: async (serverId, userId) => {
				const stmt = db.prepare(
					`INSERT OR IGNORE INTO server_members (server_id, user_id) VALUES (?, ?)`
				);
				const result = stmt.run(serverId, userId);
				if (result.changes > 0) {
					// Update members_count
					const updateStmt = db.prepare(
						`UPDATE servers SET members_count = members_count + 1 WHERE id = ?`
					);
					updateStmt.run(serverId);
				}
				return Promise.resolve({
					changes: result.changes
				});
			}
		},
		removeServerMember: {
			run: async (serverId, userId) => {
				const stmt = db.prepare(
					`DELETE FROM server_members WHERE server_id = ? AND user_id = ?`
				);
				const result = stmt.run(serverId, userId);
				if (result.changes > 0) {
					// Update members_count
					const updateStmt = db.prepare(
						`UPDATE servers SET members_count = MAX(0, members_count - 1) WHERE id = ?`
					);
					updateStmt.run(serverId);
				}
				return Promise.resolve({
					changes: result.changes
				});
			}
		},
		insertServer: {
			run: async (userId, name, status, serverUrl, serverConfig = null, authToken = null, description = null) => {
				const resolvedAuthToken = typeof authToken === "string" && authToken.trim()
					? authToken.trim()
					: null;
				const stmt = db.prepare(
					`INSERT INTO servers (user_id, name, status, server_url, auth_token, description, server_config)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
				);
				const configJson = serverConfig ? JSON.stringify(serverConfig) : null;
				const result = stmt.run(
					userId,
					name,
					status,
					serverUrl,
					resolvedAuthToken,
					description,
					configJson
				);
				return Promise.resolve({
					insertId: result.lastInsertRowid,
					changes: result.changes
				});
			}
		},
		selectTemplates: {
			all: async () => {
				const stmt = db.prepare(
					`SELECT id, name, category, description, created_at
           FROM templates
           ORDER BY name ASC`
				);
				return Promise.resolve(stmt.all());
			}
		},
		insertCreatedImage: {
			run: async (userId, filename, filePath, width, height, color, status = 'creating', meta = null) => {
				const toJsonText = (value) => {
					if (value == null) return null;
					if (typeof value === "string") return value;
					try {
						return JSON.stringify(value);
					} catch {
						return null;
					}
				};
				const stmt = db.prepare(
					`INSERT INTO created_images (user_id, filename, file_path, width, height, color, status, meta)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
				);
				const result = stmt.run(userId, filename, filePath, width, height, color, status, toJsonText(meta));
				return Promise.resolve({
					insertId: result.lastInsertRowid,
					lastInsertRowid: result.lastInsertRowid,
					changes: result.changes
				});
			}
		},
		updateCreatedImageJobCompleted: {
			run: async (id, userId, { filename, file_path, width, height, color, meta }) => {
				const toJsonText = (value) => {
					if (value == null) return null;
					if (typeof value === "string") return value;
					try {
						return JSON.stringify(value);
					} catch {
						return null;
					}
				};
				const stmt = db.prepare(
					`UPDATE created_images
             SET filename = ?, file_path = ?, width = ?, height = ?, color = ?, status = 'completed', meta = ?
             WHERE id = ? AND user_id = ?`
				);
				const result = stmt.run(
					filename,
					file_path,
					width,
					height,
					color ?? null,
					toJsonText(meta),
					id,
					userId
				);
				return Promise.resolve({ changes: result.changes });
			}
		},
		updateCreatedImageJobFailed: {
			run: async (id, userId, { meta }) => {
				const toJsonText = (value) => {
					if (value == null) return null;
					if (typeof value === "string") return value;
					try {
						return JSON.stringify(value);
					} catch {
						return null;
					}
				};
				const stmt = db.prepare(
					`UPDATE created_images
             SET status = 'failed', meta = ?
             WHERE id = ? AND user_id = ?`
				);
				const result = stmt.run(toJsonText(meta), id, userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		resetCreatedImageForRetry: {
			run: async (id, userId, { meta, filename }) => {
				const toJsonText = (value) => {
					if (value == null) return null;
					if (typeof value === "string") return value;
					try {
						return JSON.stringify(value);
					} catch {
						return null;
					}
				};
				const stmt = db.prepare(
					`UPDATE created_images
             SET status = 'creating', meta = ?, filename = ?, file_path = ''
             WHERE id = ? AND user_id = ?`
				);
				const result = stmt.run(toJsonText(meta), filename || "", id, userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		updateCreatedImageMeta: {
			run: async (id, userId, meta) => {
				const toJsonText = (value) => {
					if (value == null) return null;
					if (typeof value === "string") return value;
					try {
						return JSON.stringify(value);
					} catch {
						return null;
					}
				};
				const stmt = db.prepare(
					`UPDATE created_images SET meta = ? WHERE id = ? AND user_id = ?`
				);
				const result = stmt.run(toJsonText(meta), id, userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		updateCreatedImageStatus: {
			run: async (id, userId, status, color = null) => {
				if (color) {
					const stmt = db.prepare(
						`UPDATE created_images
             SET status = ?, color = ?
             WHERE id = ? AND user_id = ?`
					);
					const result = stmt.run(status, color, id, userId);
					return Promise.resolve({ changes: result.changes });
				} else {
					const stmt = db.prepare(
						`UPDATE created_images
             SET status = ?
             WHERE id = ? AND user_id = ?`
					);
					const result = stmt.run(status, id, userId);
					return Promise.resolve({ changes: result.changes });
				}
			}
		},
		selectCreatedImagesForUser: {
			all: async (userId, options = {}) => {
				const includeUnavailable = options?.includeUnavailable === true;
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const stmt = db.prepare(
					includeUnavailable
						? `SELECT id, filename, file_path, width, height, color, status, created_at,
                  published, published_at, title, description, meta, unavailable_at
           FROM created_images
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
						: `SELECT id, filename, file_path, width, height, color, status, created_at,
                  published, published_at, title, description, meta, unavailable_at
           FROM created_images
           WHERE user_id = ? AND (unavailable_at IS NULL OR unavailable_at = '')
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
				);
				return Promise.resolve(includeUnavailable ? stmt.all(userId, limit, offset) : stmt.all(userId, limit, offset));
			}
		},
		selectPublishedCreatedImagesForUser: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const stmt = db.prepare(
					`SELECT id, filename, file_path, width, height, color, status, created_at,
                  published, published_at, title, description, meta, unavailable_at
           FROM created_images
           WHERE user_id = ? AND published = 1 AND (unavailable_at IS NULL OR unavailable_at = '')
           ORDER BY created_at DESC
           LIMIT ? OFFSET ?`
				);
				return Promise.resolve(stmt.all(userId, limit, offset));
			}
		},
		selectPublishedCreationsByPersonalityMention: {
			all: async (personality, options = {}) => {
				const normalized = String(personality || "").trim().toLowerCase();
				if (!/^[a-z0-9][a-z0-9_-]{2,23}$/.test(normalized)) return [];
				const needle = `@${normalized}`;
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const stmt = db.prepare(
					`SELECT ci.id, ci.filename, ci.file_path, ci.width, ci.height, ci.color, ci.status, ci.created_at,
                  ci.published, ci.published_at, ci.title, ci.description, ci.meta, ci.user_id, ci.unavailable_at
           FROM created_images ci
           WHERE ci.published = 1
             AND (ci.unavailable_at IS NULL OR ci.unavailable_at = '')
             AND (
               lower(coalesce(ci.description, '')) LIKE '%' || ? || '%'
               OR lower(coalesce(ci.title, '')) LIKE '%' || ? || '%'
               OR EXISTS (
                 SELECT 1
                 FROM comments_created_image c
                 WHERE c.created_image_id = ci.id
                   AND lower(coalesce(c.text, '')) LIKE '%' || ? || '%'
               )
             )
           ORDER BY ci.created_at DESC
           LIMIT ? OFFSET ?`
				);
				return Promise.resolve(stmt.all(needle, needle, needle, limit, offset));
			}
		},
		selectPublishedCreationsByTagMention: {
			all: async (tag, options = {}) => {
				const normalized = String(tag || "").trim().toLowerCase();
				if (!/^[a-z0-9][a-z0-9_-]{1,31}$/.test(normalized)) return [];
				const needle = `#${normalized}`;
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const stmt = db.prepare(
					`SELECT ci.id, ci.filename, ci.file_path, ci.width, ci.height, ci.color, ci.status, ci.created_at,
                  ci.published, ci.published_at, ci.title, ci.description, ci.meta, ci.user_id, ci.unavailable_at
           FROM created_images ci
           WHERE ci.published = 1
             AND (ci.unavailable_at IS NULL OR ci.unavailable_at = '')
             AND (
               lower(coalesce(ci.description, '')) LIKE '%' || ? || '%'
               OR lower(coalesce(ci.title, '')) LIKE '%' || ? || '%'
               OR EXISTS (
                 SELECT 1
                 FROM comments_created_image c
                 WHERE c.created_image_id = ci.id
                   AND lower(coalesce(c.text, '')) LIKE '%' || ? || '%'
               )
             )
           ORDER BY ci.created_at DESC
           LIMIT ? OFFSET ?`
				);
				return Promise.resolve(stmt.all(needle, needle, needle, limit, offset));
			}
		},
		selectAllCreatedImageCountForUser: {
			get: async (userId) => {
				const stmt = db.prepare(
					`SELECT COUNT(*) AS count
           FROM created_images
           WHERE user_id = ? AND (unavailable_at IS NULL OR unavailable_at = '')`
				);
				return Promise.resolve(stmt.get(userId));
			}
		},
		selectPublishedCreatedImageCountForUser: {
			get: async (userId) => {
				const stmt = db.prepare(
					`SELECT COUNT(*) AS count
           FROM created_images
           WHERE user_id = ? AND published = 1 AND (unavailable_at IS NULL OR unavailable_at = '')`
				);
				return Promise.resolve(stmt.get(userId));
			}
		},
		/** Published creations this user has liked (for profile Likes tab). */
		selectCreatedImagesLikedByUser: {
			all: async (userId, options = {}) => {
				const limit = Math.min(200, Math.max(1, Number.parseInt(String(options?.limit ?? "50"), 10) || 50));
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const stmt = db.prepare(
					`SELECT ci.id, ci.filename, ci.file_path, ci.width, ci.height, ci.color, ci.status, ci.created_at,
                  ci.published, ci.published_at, ci.title, ci.description, ci.meta, ci.unavailable_at
           FROM likes_created_image l
           INNER JOIN created_images ci ON ci.id = l.created_image_id
           WHERE l.user_id = ? AND ci.published = 1 AND (ci.unavailable_at IS NULL OR ci.unavailable_at = '')
           ORDER BY l.created_at DESC
           LIMIT ? OFFSET ?`
				);
				return Promise.resolve(stmt.all(userId, limit, offset));
			}
		},
		/** Comments by this user with creation context and creator/commenter profiles (for profile Comments tab). */
		selectCommentsByUser: {
			all: async (userId, options = {}) => {
				const limitRaw = Number.parseInt(String(options?.limit ?? "50"), 10);
				const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
				const offset = Math.max(0, Number.parseInt(String(options?.offset ?? "0"), 10) || 0);
				const stmt = db.prepare(
					`SELECT c.id, c.user_id, c.created_image_id, c.text, c.created_at, c.updated_at,
                  ci.title AS created_image_title, ci.file_path AS created_image_url, ci.created_at AS created_image_created_at, ci.user_id AS created_image_user_id,
                  up.user_name AS commenter_user_name, up.display_name AS commenter_display_name, up.avatar_url AS commenter_avatar_url,
                  cup.user_name AS creator_user_name, cup.display_name AS creator_display_name, cup.avatar_url AS creator_avatar_url
           FROM comments_created_image c
           INNER JOIN created_images ci ON ci.id = c.created_image_id
           LEFT JOIN user_profiles up ON up.user_id = c.user_id
           LEFT JOIN user_profiles cup ON cup.user_id = ci.user_id
           WHERE c.user_id = ? AND ci.published = 1 AND (ci.unavailable_at IS NULL OR ci.unavailable_at = '')
           ORDER BY c.created_at DESC
           LIMIT ? OFFSET ?`
				);
				return Promise.resolve(stmt.all(userId, limit, offset));
			}
		},
		selectLikesReceivedForUserPublished: {
			get: async (userId) => {
				const stmt = db.prepare(
					`SELECT COUNT(*) AS count
           FROM likes_created_image l
           INNER JOIN created_images ci ON ci.id = l.created_image_id
           WHERE ci.user_id = ? AND ci.published = 1 AND (ci.unavailable_at IS NULL OR ci.unavailable_at = '')`
				);
				return Promise.resolve(stmt.get(userId));
			}
		},
		selectCreatedImageById: {
			get: async (id, userId) => {
				const stmt = db.prepare(
					`SELECT id, filename, file_path, width, height, color, status, created_at,
                  published, published_at, title, description, user_id, meta, unavailable_at
           FROM created_images
           WHERE id = ? AND user_id = ?`
				);
				return Promise.resolve(stmt.get(id, userId));
			}
		},
		selectCreatedImageByIdAnyUser: {
			get: async (id) => {
				const stmt = db.prepare(
					`SELECT id, filename, file_path, width, height, color, status, created_at,
                  published, published_at, title, description, user_id, meta, unavailable_at
           FROM created_images
           WHERE id = ?`
				);
				return Promise.resolve(stmt.get(id));
			}
		},
		selectCreatedImageByFilename: {
			get: async (filename) => {
				const stmt = db.prepare(
					`SELECT id, filename, file_path, width, height, color, status, created_at,
                  published, published_at, title, description, user_id, meta
           FROM created_images
           WHERE filename = ?`
				);
				return Promise.resolve(stmt.get(filename));
			}
		},
		/** Direct children: published creations with meta.mutate_of_id = parentId, ordered by created_at asc. */
		selectCreatedImageChildrenByParentId: {
			all: async (parentId) => {
				const id = Number(parentId);
				if (!Number.isFinite(id) || id <= 0) return [];
				// Match mutate_of_id whether stored as number or string in JSON
				const stmt = db.prepare(
					`SELECT id, filename, file_path, title, created_at, status
           FROM created_images
           WHERE (json_extract(meta, '$.mutate_of_id') = ? OR json_extract(meta, '$.mutate_of_id') = ?)
             AND (published = 1)
             AND (unavailable_at IS NULL OR unavailable_at = '')
           ORDER BY created_at ASC`
				);
				return Promise.resolve(stmt.all(id, String(id)));
			}
		},
		// Anonymous (try) creations (no anon_cid or color; try_requests links requesters to images)
		insertCreatedImageAnon: {
			run: async (prompt, filename, filePath, width, height, status, meta) => {
				const toJsonText = (v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));
				const stmt = db.prepare(
					`INSERT INTO created_images_anon (prompt, filename, file_path, width, height, status, meta)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
				);
				const result = stmt.run(prompt ?? null, filename, filePath, width, height, status, toJsonText(meta));
				return Promise.resolve({ insertId: result.lastInsertRowid, changes: result.changes });
			}
		},
		selectCreatedImageAnonById: {
			get: async (id) => {
				const stmt = db.prepare(
					`SELECT id, prompt, filename, file_path, width, height, status, created_at, meta
           FROM created_images_anon WHERE id = ?`
				);
				return Promise.resolve(stmt.get(id));
			}
		},
		selectCreatedImagesAnonByIds: {
			all: async (ids) => {
				const safeIds = Array.isArray(ids)
					? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
					: [];
				if (safeIds.length === 0) return [];
				const placeholders = safeIds.map(() => "?").join(",");
				const stmt = db.prepare(
					`SELECT id, prompt, filename, file_path, width, height, status, created_at, meta
           FROM created_images_anon WHERE id IN (${placeholders})`
				);
				return Promise.resolve(stmt.all(...safeIds));
			}
		},
		/** Up to limit recent completed rows for this prompt, for cache reuse. sinceIso = created_at >= this (e.g. 24h ago). */
		selectRecentCompletedCreatedImageAnonByPrompt: {
			all: async (prompt, sinceIso, limit = 5) => {
				if (prompt == null || String(prompt).trim() === "") return [];
				const safeLimit = Math.min(Math.max(Number(limit) || 5, 1), 20);
				const stmt = db.prepare(
					`SELECT id, prompt, filename, file_path, width, height, status, created_at, meta
           FROM created_images_anon WHERE prompt = ? AND status = 'completed' AND created_at >= ?
           ORDER BY created_at DESC LIMIT ?`
				);
				return Promise.resolve(stmt.all(String(prompt).trim(), sinceIso, safeLimit));
			}
		},
		selectCreatedImageAnonByFilename: {
			get: async (filename) => {
				if (!filename || typeof filename !== "string" || filename.includes("..") || filename.includes("/"))
					return undefined;
				const stmt = db.prepare(
					`SELECT id, prompt, filename, file_path, width, height, status, created_at, meta
           FROM created_images_anon WHERE filename = ? ORDER BY id DESC LIMIT 1`
				);
				return Promise.resolve(stmt.get(filename.trim()));
			}
		},
		countCreatedImagesAnonByFilename: {
			get: async (filename) => {
				if (!filename || typeof filename !== "string" || filename.includes("..") || filename.includes("/"))
					return { count: 0 };
				const row = db.prepare(`SELECT COUNT(*) AS count FROM created_images_anon WHERE filename = ?`).get(filename.trim());
				return Promise.resolve(row ? { count: row.count } : { count: 0 });
			}
		},
		/** Set created_image_anon_id = null for all try_requests pointing to this anon id (e.g. when discarding). */
		updateTryRequestsNullAnonId: {
			run: async (createdImageAnonId) => {
				const id = Number(createdImageAnonId);
				const rows = db.prepare(`SELECT id FROM try_requests WHERE created_image_anon_id = ?`).all(id);
				const updateStmt = db.prepare(`UPDATE try_requests SET created_image_anon_id = NULL WHERE id = ?`);
				for (const row of rows) updateStmt.run(row.id);
				return Promise.resolve({ changes: rows.length });
			}
		},
		updateTryRequestsTransitionedByCreatedImageAnonId: {
			run: async (createdImageAnonId, { userId, createdImageId }) => {
				const id = Number(createdImageAnonId);
				const rows = db.prepare(`SELECT id, meta FROM try_requests WHERE created_image_anon_id = ?`).all(id);
				const at = new Date().toISOString();
				const transitioned = { at, user_id: Number(userId), created_image_id: Number(createdImageId) };
				const updateStmt = db.prepare(`UPDATE try_requests SET created_image_anon_id = NULL, meta = ? WHERE id = ?`);
				for (const row of rows) {
					let meta = null;
					try {
						meta = row.meta && typeof row.meta === "string" ? JSON.parse(row.meta) : typeof row.meta === "object" ? row.meta : {};
					} catch {
						meta = {};
					}
					if (typeof meta !== "object" || meta === null) meta = {};
					meta = { ...meta, transitioned };
					updateStmt.run(JSON.stringify(meta), row.id);
				}
				return Promise.resolve({ changes: rows.length });
			}
		},
		deleteCreatedImageAnon: {
			run: async (id) => {
				const stmt = db.prepare(`DELETE FROM created_images_anon WHERE id = ?`);
				const result = stmt.run(Number(id));
				return Promise.resolve({ changes: result.changes });
			}
		},
		selectTryRequestByCidAndPrompt: {
			get: async (anonCid, prompt) => {
				if (prompt == null || String(prompt).trim() === "") return undefined;
				const stmt = db.prepare(
					`SELECT id, anon_cid, prompt, created_at, fulfilled_at, created_image_anon_id
           FROM try_requests WHERE anon_cid = ? AND prompt = ? ORDER BY created_at DESC LIMIT 1`
				);
				return Promise.resolve(stmt.get(anonCid, String(prompt).trim()));
			}
		},
		selectTryRequestsByCid: {
			all: async (anonCid) => {
				const stmt = db.prepare(
					`SELECT id, anon_cid, prompt, created_at, fulfilled_at, created_image_anon_id
           FROM try_requests WHERE anon_cid = ? ORDER BY created_at DESC`
				);
				return Promise.resolve(stmt.all(anonCid));
			}
		},
		/** Unique anon_cids from try_requests with request count; excludes __pool__. Order by last_request_at desc. */
		selectTryRequestAnonCidsWithCount: {
			all: async () => {
				const stmt = db.prepare(
					`SELECT anon_cid, COUNT(*) AS request_count, MIN(created_at) AS first_request_at, MAX(created_at) AS last_request_at
           FROM try_requests WHERE anon_cid != '__pool__' GROUP BY anon_cid ORDER BY last_request_at DESC`
				);
				return Promise.resolve(stmt.all());
			}
		},
		/** Rows where created_image_anon_id IS NULL (transitioned); returns anon_cid, meta for building transition map. */
		selectTryRequestsTransitionedMeta: {
			all: async () => {
				const stmt = db.prepare(
					`SELECT anon_cid, meta FROM try_requests WHERE created_image_anon_id IS NULL AND meta IS NOT NULL AND meta != ''`
				);
				return Promise.resolve(stmt.all());
			}
		},
		updateCreatedImageAnonJobCompleted: {
			run: async (id, { filename, file_path, width, height, meta }) => {
				const toJsonText = (v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));
				const stmt = db.prepare(
					`UPDATE created_images_anon
             SET filename = ?, file_path = ?, width = ?, height = ?, status = 'completed', meta = ?
             WHERE id = ?`
				);
				const result = stmt.run(filename, file_path, width, height, toJsonText(meta), id);
				return Promise.resolve({ changes: result.changes });
			}
		},
		updateCreatedImageAnonJobFailed: {
			run: async (id, { meta }) => {
				const toJsonText = (v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));
				const stmt = db.prepare(
					`UPDATE created_images_anon SET status = 'failed', meta = ? WHERE id = ?`
				);
				const result = stmt.run(toJsonText(meta), id);
				return Promise.resolve({ changes: result.changes });
			}
		},
		insertTryRequest: {
			run: async (anonCid, prompt, created_image_anon_id, fulfilled_at = null, meta = null) => {
				const toJsonText = (v) => (v == null ? null : typeof v === "string" ? v : JSON.stringify(v));
				const stmt = db.prepare(
					`INSERT INTO try_requests (anon_cid, prompt, created_image_anon_id, fulfilled_at, meta)
           VALUES (?, ?, ?, ?, ?)`
				);
				const result = stmt.run(anonCid, prompt ?? null, created_image_anon_id, fulfilled_at, toJsonText(meta));
				return Promise.resolve({ insertId: result.lastInsertRowid, changes: result.changes });
			}
		},
		updateTryRequestFulfilledByCreatedImageAnonId: {
			run: async (created_image_anon_id, fulfilled_at_iso) => {
				const stmt = db.prepare(
					`UPDATE try_requests SET fulfilled_at = ? WHERE created_image_anon_id = ? AND fulfilled_at IS NULL`
				);
				const result = stmt.run(fulfilled_at_iso, created_image_anon_id);
				return Promise.resolve({ changes: result.changes });
			}
		},
		selectCreatedImageDescriptionAndMetaByIds: {
			all: async (ids) => {
				const safeIds = Array.isArray(ids)
					? ids.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)
					: [];
				if (safeIds.length === 0) return [];
				const placeholders = safeIds.map(() => "?").join(",");
				const stmt = db.prepare(
					`SELECT id, description, meta FROM created_images WHERE id IN (${placeholders})`
				);
				const rows = stmt.all(...safeIds);
				return rows ?? [];
			}
		},
		insertCreatedImageLike: {
			run: async (userId, createdImageId) => {
				const stmt = db.prepare(
					`INSERT OR IGNORE INTO likes_created_image (user_id, created_image_id)
           VALUES (?, ?)`
				);
				const result = stmt.run(userId, createdImageId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		deleteCreatedImageLike: {
			run: async (userId, createdImageId) => {
				const stmt = db.prepare(
					`DELETE FROM likes_created_image
           WHERE user_id = ? AND created_image_id = ?`
				);
				const result = stmt.run(userId, createdImageId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		selectCreatedImageLikeCount: {
			get: async (createdImageId) => {
				const stmt = db.prepare(
					`SELECT COUNT(*) AS like_count
           FROM likes_created_image
           WHERE created_image_id = ?`
				);
				return Promise.resolve(stmt.get(createdImageId));
			}
		},
		selectCreatedImageViewerLiked: {
			get: async (userId, createdImageId) => {
				const stmt = db.prepare(
					`SELECT 1 AS viewer_liked
           FROM likes_created_image
           WHERE user_id = ? AND created_image_id = ?
           LIMIT 1`
				);
				return Promise.resolve(stmt.get(userId, createdImageId));
			}
		},
		selectViewerLikedCreationIds: {
			all: async (userId, creationIds) => {
				const safeIds = Array.isArray(creationIds)
					? creationIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0)
					: [];
				if (safeIds.length === 0) return [];
				const placeholders = safeIds.map(() => "?").join(",");
				const stmt = db.prepare(
					`SELECT created_image_id FROM likes_created_image WHERE user_id = ? AND created_image_id IN (${placeholders})`
				);
				const rows = stmt.all(userId, ...safeIds);
				return rows.map((r) => Number(r.created_image_id));
			}
		},
		insertCreatedImageComment: {
			run: async (userId, createdImageId, text) => {
				const insertStmt = db.prepare(
					`INSERT INTO comments_created_image (user_id, created_image_id, text)
           VALUES (?, ?, ?)`
				);
				const result = insertStmt.run(userId, createdImageId, text);
				const id = Number(result.lastInsertRowid);

				const selectStmt = db.prepare(
					`SELECT c.id, c.user_id, c.created_image_id, c.text, c.created_at, c.updated_at,
                  up.user_name, up.display_name, up.avatar_url
           FROM comments_created_image c
           LEFT JOIN user_profiles up ON up.user_id = c.user_id
           WHERE c.id = ?`
				);
				const row = selectStmt.get(id);
				return Promise.resolve({
					...row,
					changes: result.changes,
					insertId: id,
					lastInsertRowid: id
				});
			}
		},
		selectCreatedImageCommenterUserIdsDistinct: {
			all: async (createdImageId) => {
				const stmt = db.prepare(
					`SELECT DISTINCT user_id
           FROM comments_created_image
           WHERE created_image_id = ?`
				);
				const rows = stmt.all(createdImageId) ?? [];
				return Promise.resolve(
					rows
						.map((row) => Number(row?.user_id))
						.filter((id) => Number.isFinite(id) && id > 0)
				);
			}
		},
		selectCreatedImageComments: {
			all: async (createdImageId, options = {}) => {
				const order = String(options?.order || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
				const limitRaw = Number.parseInt(String(options?.limit ?? "50"), 10);
				const offsetRaw = Number.parseInt(String(options?.offset ?? "0"), 10);
				const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
				const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

				const stmt = db.prepare(
					`SELECT c.id, c.user_id, c.created_image_id, c.text, c.created_at, c.updated_at,
                  up.user_name, up.display_name, up.avatar_url,
                  json_extract(u.meta,'$.plan') AS plan
           FROM comments_created_image c
           LEFT JOIN user_profiles up ON up.user_id = c.user_id
           LEFT JOIN users u ON u.id = c.user_id
           WHERE c.created_image_id = ?
           ORDER BY c.created_at ${order}
           LIMIT ? OFFSET ?`
				);
				return Promise.resolve(stmt.all(createdImageId, limit, offset));
			}
		},
		selectLatestCreatedImageComments: {
			all: async (options = {}) => {
				const limitRaw = Number.parseInt(String(options?.limit ?? "10"), 10);
				const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 10;

				const stmt = db.prepare(
					`SELECT c.id, c.user_id, c.created_image_id, c.text, c.created_at, c.updated_at,
                  up.user_name, up.display_name, up.avatar_url,
                  json_extract(u.meta,'$.plan') AS plan,
                  ci.title AS created_image_title,
                  ci.file_path AS created_image_url,
                  ci.created_at AS created_image_created_at,
                  ci.user_id AS created_image_user_id,
                  cup.user_name AS created_image_user_name,
                  cup.display_name AS created_image_display_name,
                  cup.avatar_url AS created_image_avatar_url,
                  json_extract(cu.meta,'$.plan') AS created_image_owner_plan
           FROM comments_created_image c
           INNER JOIN created_images ci ON ci.id = c.created_image_id
           LEFT JOIN user_profiles up ON up.user_id = c.user_id
           LEFT JOIN users u ON u.id = c.user_id
           LEFT JOIN user_profiles cup ON cup.user_id = ci.user_id
           LEFT JOIN users cu ON cu.id = ci.user_id
           WHERE ci.published = 1
           ORDER BY c.created_at DESC
           LIMIT ?`
				);
				const rows = stmt.all(limit);
				return Promise.resolve(rows.map((r) => ({
					...r,
					plan: r.plan === 'founder' ? 'founder' : 'free',
					created_image_owner_plan: r.created_image_owner_plan === 'founder' ? 'founder' : 'free'
				})));
			}
		},
		selectCreatedImageCommentCount: {
			get: async (createdImageId) => {
				const stmt = db.prepare(
					`SELECT COUNT(*) AS comment_count
           FROM comments_created_image
           WHERE created_image_id = ?`
				);
				return Promise.resolve(stmt.get(createdImageId));
			}
		},
		publishCreatedImage: {
			run: async (id, userId, title, description, isAdmin = false) => {
				// Admin can publish any image, owner can only publish their own
				const stmt = isAdmin
					? db.prepare(
						`UPDATE created_images
           SET published = 1, published_at = datetime('now'), title = ?, description = ?
           WHERE id = ?`
					)
					: db.prepare(
						`UPDATE created_images
           SET published = 1, published_at = datetime('now'), title = ?, description = ?
           WHERE id = ? AND user_id = ?`
					);
				const result = isAdmin
					? stmt.run(title, description, id)
					: stmt.run(title, description, id, userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		markCreatedImageUnavailable: {
			run: async (id, userId) => {
				const now = new Date().toISOString();
				const stmt = db.prepare(
					`UPDATE created_images
           SET unavailable_at = ?
           WHERE id = ? AND user_id = ?`
				);
				const result = stmt.run(now, id, userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		deleteCreatedImageById: {
			run: async (id, userId) => {
				const stmt = db.prepare(
					`DELETE FROM created_images
           WHERE id = ? AND user_id = ?`
				);
				const result = stmt.run(id, userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		insertFeedItem: {
			run: async (title, summary, author, tags, createdImageId) => {
				const stmt = db.prepare(
					`INSERT INTO feed_items (title, summary, author, tags, created_image_id)
           VALUES (?, ?, ?, ?, ?)`
				);
				const result = stmt.run(title, summary, author, tags || null, createdImageId || null);
				return Promise.resolve({
					insertId: result.lastInsertRowid,
					lastInsertRowid: result.lastInsertRowid,
					changes: result.changes
				});
			}
		},
		selectFeedItemByCreatedImageId: {
			get: async (createdImageId) => {
				const stmt = db.prepare(
					`SELECT id, title, summary, author, tags, created_at, created_image_id
           FROM feed_items
           WHERE created_image_id = ?
           ORDER BY created_at DESC
           LIMIT 1`
				);
				return Promise.resolve(stmt.get(createdImageId));
			}
		},
		updateCreatedImage: {
			run: async (id, userId, title, description, isAdmin = false) => {
				// Admin can update any image, owner can only update their own
				const stmt = isAdmin
					? db.prepare(
						`UPDATE created_images
             SET title = ?, description = ?
             WHERE id = ?`
					)
					: db.prepare(
						`UPDATE created_images
             SET title = ?, description = ?
             WHERE id = ? AND user_id = ?`
					);
				const result = isAdmin
					? stmt.run(title, description, id)
					: stmt.run(title, description, id, userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		unpublishCreatedImage: {
			run: async (id, userId, isAdmin = false) => {
				// Admin can unpublish any image, owner can only unpublish their own
				const stmt = isAdmin
					? db.prepare(
						`UPDATE created_images
             SET published = 0, published_at = NULL
             WHERE id = ?`
					)
					: db.prepare(
						`UPDATE created_images
             SET published = 0, published_at = NULL
             WHERE id = ? AND user_id = ?`
					);
				const result = isAdmin
					? stmt.run(id)
					: stmt.run(id, userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		updateFeedItem: {
			run: async (createdImageId, title, summary) => {
				const stmt = db.prepare(
					`UPDATE feed_items
           SET title = ?, summary = ?
           WHERE created_image_id = ?`
				);
				const result = stmt.run(title, summary, createdImageId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		deleteFeedItemByCreatedImageId: {
			run: async (createdImageId) => {
				const stmt = db.prepare(
					`DELETE FROM feed_items
           WHERE created_image_id = ?`
				);
				const result = stmt.run(createdImageId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		deleteAllLikesForCreatedImage: {
			run: async (createdImageId) => {
				const stmt = db.prepare(
					`DELETE FROM likes_created_image
           WHERE created_image_id = ?`
				);
				const result = stmt.run(createdImageId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		deleteAllCommentsForCreatedImage: {
			run: async (createdImageId) => {
				const stmt = db.prepare(
					`DELETE FROM comments_created_image
           WHERE created_image_id = ?`
				);
				const result = stmt.run(createdImageId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		selectUserCredits: {
			get: async (userId) => {
				const stmt = db.prepare(
					`SELECT id, user_id, balance, last_daily_claim_at, created_at, updated_at
           FROM user_credits
           WHERE user_id = ?`
				);
				return Promise.resolve(stmt.get(userId));
			}
		},
		insertUserCredits: {
			run: async (userId, balance, lastDailyClaimAt) => {
				const stmt = db.prepare(
					`INSERT INTO user_credits (user_id, balance, last_daily_claim_at)
           VALUES (?, ?, ?)`
				);
				const result = stmt.run(userId, balance, lastDailyClaimAt || null);
				return Promise.resolve({
					insertId: result.lastInsertRowid,
					lastInsertRowid: result.lastInsertRowid,
					changes: result.changes
				});
			}
		},
		updateUserCreditsBalance: {
			run: async (userId, amount) => {
				// First get current balance to prevent negative credits
				const selectStmt = db.prepare(
					`SELECT balance FROM user_credits WHERE user_id = ?`
				);
				const current = selectStmt.get(userId);
				const currentBalance = current?.balance ?? 0;
				const newBalance = currentBalance + amount;

				// Prevent negative credits - ensure balance never goes below 0
				const finalBalance = Math.max(0, newBalance);

				const stmt = db.prepare(
					`UPDATE user_credits
           SET balance = ?, updated_at = datetime('now')
           WHERE user_id = ?`
				);
				const result = stmt.run(finalBalance, userId);
				return Promise.resolve({ changes: result.changes });
			}
		},
		claimDailyCredits: {
			run: async (userId, amount = 10) => {
				// Check if user can claim (last claim was not today in UTC)
				const checkStmt = db.prepare(
					`SELECT id, balance, last_daily_claim_at
           FROM user_credits
           WHERE user_id = ?`
				);
				const credits = checkStmt.get(userId);

				if (!credits) {
					// No credits record exists, create one with the daily amount
					const nowUTC = new Date().toISOString();
					const insertStmt = db.prepare(
						`INSERT INTO user_credits (user_id, balance, last_daily_claim_at, updated_at)
             VALUES (?, ?, ?, ?)`
					);
					insertStmt.run(userId, amount, nowUTC, nowUTC);
					return Promise.resolve({
						success: true,
						balance: amount,
						changes: 1
					});
				}

				// Check if already claimed today (UTC)
				const now = new Date();
				const todayUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
				const todayUTCStr = todayUTC.toISOString().slice(0, 10);

				if (credits.last_daily_claim_at) {
					const lastClaimDate = new Date(credits.last_daily_claim_at);
					const lastClaimUTC = new Date(Date.UTC(lastClaimDate.getUTCFullYear(), lastClaimDate.getUTCMonth(), lastClaimDate.getUTCDate()));
					const lastClaimUTCStr = lastClaimUTC.toISOString().slice(0, 10);

					if (lastClaimUTCStr >= todayUTCStr) {
						// Already claimed today
						return Promise.resolve({
							success: false,
							balance: credits.balance,
							changes: 0,
							message: 'Daily credits already claimed today'
						});
					}
				}

				// Update balance and last claim date (using UTC)
				const nowUTC = new Date().toISOString();
				const updateStmt = db.prepare(
					`UPDATE user_credits
           SET balance = balance + ?, 
               last_daily_claim_at = ?,
               updated_at = ?
           WHERE user_id = ?`
				);
				const result = updateStmt.run(amount, nowUTC, nowUTC, userId);

				// Get new balance
				const newBalanceStmt = db.prepare(
					`SELECT balance FROM user_credits WHERE user_id = ?`
				);
				const newCredits = newBalanceStmt.get(userId);

				return Promise.resolve({
					success: true,
					balance: newCredits.balance,
					changes: result.changes
				});
			}
		},
		transferCredits: {
			run: async (fromUserId, toUserId, amount) => {
				const result = transferCreditsTxn(Number(fromUserId), Number(toUserId), Number(amount));
				return Promise.resolve(result);
			}
		},
		insertTipActivity: {
			run: async (fromUserId, toUserId, createdImageId, amount, message, source, meta) => {
				const toJsonText = (value) => {
					if (value == null) return null;
					if (typeof value === "string") return value;
					try {
						return JSON.stringify(value);
					} catch {
						return null;
					}
				};
				const stmt = db.prepare(
					`INSERT INTO tip_activity (
            from_user_id,
            to_user_id,
            created_image_id,
            amount,
            message,
            source,
            meta,
            created_at,
            updated_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now')
          )`
				);
				const result = stmt.run(
					fromUserId,
					toUserId,
					createdImageId || null,
					amount,
					message ?? null,
					source ?? null,
					toJsonText(meta)
				);
				return Promise.resolve({
					insertId: result.lastInsertRowid,
					lastInsertRowid: result.lastInsertRowid,
					changes: result.changes
				});
			}
		},
		selectCreatedImageTips: {
			all: async (createdImageId, options = {}) => {
				const order = String(options?.order || "asc").toLowerCase() === "desc" ? "DESC" : "ASC";
				const limitRaw = Number.parseInt(String(options?.limit ?? "50"), 10);
				const offsetRaw = Number.parseInt(String(options?.offset ?? "0"), 10);
				const limit = Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 50;
				const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

				const stmt = db.prepare(
					`SELECT
            t.id,
            t.from_user_id AS user_id,
            t.created_image_id,
            t.amount,
            t.message,
            t.source,
            t.meta,
            t.created_at,
            t.updated_at,
            up.user_name,
            up.display_name,
            up.avatar_url,
            json_extract(u.meta,'$.plan') AS plan
           FROM tip_activity t
           LEFT JOIN user_profiles up ON up.user_id = t.from_user_id
           LEFT JOIN users u ON u.id = t.from_user_id
           WHERE t.created_image_id = ?
           ORDER BY t.created_at ${order}
           LIMIT ? OFFSET ?`
				);
				return Promise.resolve(stmt.all(createdImageId, limit, offset));
			}
		},
		deleteUserAndCleanup: {
			run: async (userId) => {
				const result = deleteUserAndCleanupTxn(userId);
				return Promise.resolve(result);
			}
		}
	};

	async function seed(tableName, items, options = {}) {
		if (!items || items.length === 0) return;

		const { skipIfExists = false, transform, checkExists } = options;

		// Check if we should skip seeding
		if (skipIfExists) {
			if (checkExists) {
				// Use custom check function (must be async now)
				const existing = await checkExists();
				if (existing && existing.length > 0) return;
			} else {
				// Default: check if table has any rows
				const count = db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
				if (count > 0) return;
			}
		}

		// Get column names from first item
		const firstItem = transform ? transform(items[0]) : items[0];
		const columns = Object.keys(firstItem).filter(key => firstItem[key] !== undefined);
		const placeholders = columns.map(() => "?").join(", ");
		const columnNames = columns.join(", ");

		const stmt = db.prepare(
			`INSERT INTO ${tableName} (${columnNames}) VALUES (${placeholders})`
		);

		// Insert all items
		for (const item of items) {
			const transformedItem = transform ? transform(item) : item;
			const values = columns.map(col => transformedItem[col]);
			stmt.run(...values);
		}
	}

	async function reset() {
		// Close existing connection if open
		if (db) {
			db.close();
		}
		// Delete the database file
		// The database will be recreated on the next openDb() call
		if (fs.existsSync(dbPath)) {
			fs.unlinkSync(dbPath);
		}
	}

	// Storage interface for images
	const imagesDir = path.join(dataDir, "images", "created");
	const imagesDirAnon = path.join(dataDir, "images", "created_anon");
	const genericImagesDir = path.join(dataDir, "images", "generic");

	function ensureImagesDir() {
		if (!fs.existsSync(imagesDir)) {
			fs.mkdirSync(imagesDir, { recursive: true });
		}
	}

	function ensureImagesDirAnon() {
		if (!fs.existsSync(imagesDirAnon)) {
			fs.mkdirSync(imagesDirAnon, { recursive: true });
		}
	}

	function ensureGenericImagesDir() {
		if (!fs.existsSync(genericImagesDir)) {
			fs.mkdirSync(genericImagesDir, { recursive: true });
		}
	}

	function safeJoin(baseDir, key) {
		const raw = String(key || "");
		const normalized = raw.replace(/\\/g, "/");
		const stripped = normalized.replace(/^\/+/, "");
		const resolved = path.resolve(baseDir, stripped);
		const baseResolved = path.resolve(baseDir);
		if (!resolved.startsWith(baseResolved + path.sep) && resolved !== baseResolved) {
			throw new Error("Invalid key");
		}
		return { resolved, stripped };
	}

	const storage = {
		uploadImage: async (buffer, filename) => {
			ensureImagesDir();
			const filePath = path.join(imagesDir, filename);
			fs.writeFileSync(filePath, buffer);
			return `/images/created/${filename}`;
		},

		getImageUrl: (filename) => {
			return `/images/created/${filename}`;
		},

		getImageBuffer: async (filename) => {
			const filePath = path.join(imagesDir, filename);
			if (!fs.existsSync(filePath)) {
				throw new Error(`Image not found: ${filename}`);
			}
			return fs.readFileSync(filePath);
		},

		uploadImageAnon: async (buffer, filename) => {
			ensureImagesDirAnon();
			const filePath = path.join(imagesDirAnon, filename);
			fs.writeFileSync(filePath, buffer);
			return `/api/try/images/${filename}`;
		},

		getImageUrlAnon: (filename) => `/api/try/images/${filename}`,

		getImageBufferAnon: async (filename) => {
			const filePath = path.join(imagesDirAnon, filename);
			if (!fs.existsSync(filePath)) {
				throw new Error(`Image not found: ${filename}`);
			}
			return fs.readFileSync(filePath);
		},

		deleteImageAnon: async (filename) => {
			if (!filename || filename.includes("..") || filename.includes("/")) return;
			const filePath = path.join(imagesDirAnon, filename);
			try {
				if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
			} catch (_) {}
		},

		getGenericImageBuffer: async (key) => {
			ensureGenericImagesDir();
			const safeKey = String(key || "");
			const { resolved: filePath } = safeJoin(genericImagesDir, safeKey);
			if (!fs.existsSync(filePath)) {
				throw new Error(`Image not found: ${safeKey}`);
			}
			return fs.readFileSync(filePath);
		},

		uploadGenericImage: async (buffer, key) => {
			ensureGenericImagesDir();
			const safeKey = String(key || "");
			const { resolved: filePath, stripped } = safeJoin(genericImagesDir, safeKey);
			const dir = path.dirname(filePath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}
			fs.writeFileSync(filePath, buffer);
			return stripped;
		},

		deleteGenericImage: async (key) => {
			ensureGenericImagesDir();
			const safeKey = String(key || "");
			const { resolved: filePath } = safeJoin(genericImagesDir, safeKey);
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		},

		deleteImage: async (filename) => {
			const filePath = path.join(imagesDir, filename);
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		},

		clearAll: async () => {
			if (fs.existsSync(imagesDir)) {
				const files = fs.readdirSync(imagesDir);
				for (const file of files) {
					const filePath = path.join(imagesDir, file);
					const stat = fs.statSync(filePath);
					if (stat.isFile()) {
						fs.unlinkSync(filePath);
					}
				}
			}
		}
	};

	return { db, queries, seed, reset, storage };
}
