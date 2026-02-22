import { getNotificationDisplayName } from "./displayName.js";

function parseJson(value) {
	if (value == null) return null;
	if (typeof value === "object") return value;
	if (typeof value !== "string") return null;
	try {
		return JSON.parse(value);
	} catch {
		return null;
	}
}

/**
 * Resolve title, message, and link for a notification that has type/actor/target/meta.
 * Uses current DB state (actor display name, creation title) so copy can change over time.
 * @param {{ type?: string | null, actor_user_id?: number | null, target?: string | object | null, meta?: string | object | null }} row
 * @param {{ selectUserById?: { get: (id: number) => Promise<object> }, selectUserProfileByUserId?: { get: (id: number) => Promise<object> }, selectCreatedImageByIdAnyUser?: { get: (id: number) => Promise<object> } }} queries
 * @returns {{ title: string, message: string, link: string, creation_title?: string | null } | null} resolved payload or null to use stored title/message/link
 */
export async function resolveNotificationDisplay(row, queries) {
	const type = typeof row?.type === "string" ? row.type.trim() : null;
	const actorUserId = row?.actor_user_id != null && Number.isFinite(Number(row.actor_user_id)) ? Number(row.actor_user_id) : null;
	if (!type || !actorUserId) return null;

	const target = parseJson(row?.target);
	const meta = parseJson(row?.meta);

	let actorUser = null;
	let actorProfile = null;
	try {
		actorUser = await queries.selectUserById?.get(actorUserId) ?? null;
		actorProfile = await queries.selectUserProfileByUserId?.get(actorUserId) ?? null;
	} catch {
		return null;
	}
	const actorName = getNotificationDisplayName(actorUser, actorProfile);

	const creationId = target?.creation_id != null && Number.isFinite(Number(target.creation_id)) ? Number(target.creation_id) : null;
	let creationTitle = typeof meta?.creation_title === "string" ? meta.creation_title.trim() : null;
	if (creationId != null && !creationTitle && queries.selectCreatedImageByIdAnyUser?.get) {
		try {
			const creation = await queries.selectCreatedImageByIdAnyUser.get(creationId);
			creationTitle = typeof creation?.title === "string" ? creation.title.trim() : null;
		} catch {
			// keep creationTitle as is
		}
	}

	const baseLink = creationId != null ? `/creations/${encodeURIComponent(String(creationId))}` : "/";

	switch (type) {
		case "comment": {
			const title = creationTitle
				? `Comment on "${creationTitle}"`
				: "Comment on your creation";
			const message = `${actorName} commented`;
			return { title, message, link: baseLink, creation_title: creationTitle || null };
		}
		case "comment_thread": {
			const title = creationTitle
				? `Comment on "${creationTitle}"`
				: "Comment on a creation you commented on";
			const message = `${actorName} commented`;
			return { title, message, link: baseLink, creation_title: creationTitle || null };
		}
		case "tip": {
			const amount = meta?.amount != null && Number.isFinite(Number(meta.amount)) ? Number(meta.amount) : null;
			const amountStr = amount != null ? `${amount.toFixed(1)}` : "some";
			const title = "You received a tip";
			const message = `${actorName} tipped you ${amountStr} credits.`;
			return { title, message, link: baseLink, creation_title: creationTitle || null };
		}
		default:
			return null;
	}
}
