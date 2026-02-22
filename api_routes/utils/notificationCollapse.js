/**
 * Extract creation_id from a notification row (target JSON or link like /creations/123).
 * @param {{ target?: string | object | null, link?: string | null }} row
 * @returns {number | null}
 */
function getCreationIdFromRow(row) {
	if (row?.target != null) {
		const target = typeof row.target === "string"
			? (() => { try { return JSON.parse(row.target); } catch { return null; } })()
			: row.target;
		const id = target?.creation_id;
		if (id != null && Number.isFinite(Number(id))) return Number(id);
	}
	const link = typeof row?.link === "string" ? row.link.trim() : "";
	const match = link.match(/^\/creations\/(\d+)/);
	if (match && match[1]) {
		const id = Number(match[1]);
		if (Number.isFinite(id)) return id;
	}
	return null;
}

const COLLAPSE_TYPES = new Set(["comment", "comment_thread", "tip"]);

/** Only collapse notifications from the last N hours; older ones stay individual. */
const RECENT_WITHIN_HOURS = 24;

function getRecentCutoffIso(hoursAgo = RECENT_WITHIN_HOURS) {
	const d = new Date();
	d.setHours(d.getHours() - hoursAgo);
	return d.toISOString();
}

function stripForResponse(n) {
	return {
		id: n.id,
		title: n.title,
		message: n.message,
		link: n.link,
		type: n.type ?? null,
		created_at: n.created_at,
		acknowledged_at: n.acknowledged_at
	};
}

/**
 * Collapse notifications that belong to the same creation (comment, comment_thread, tip only)
 * into a single summary per creation. Only recent notifications (within RECENT_WITHIN_HOURS) are
 * collapsed; older ones are left as individual items so we don't collapse full history.
 * @param {Array<{ id: number, title: string, message: string, link: string | null, type: string | null, created_at: string, acknowledged_at: string | null, creation_id: number | null, creation_title?: string | null }>} notifications
 * @returns {Array<{ id: number, title: string, message: string, link: string | null, type: string, created_at: string, acknowledged_at: string | null }>}
 */
export function collapseNotificationsByCreation(notifications) {
	const cutoff = getRecentCutoffIso();
	const recent = [];
	const older = [];
	for (const n of notifications) {
		if ((n.created_at || "").localeCompare(cutoff) >= 0) {
			recent.push(n);
		} else {
			older.push(n);
		}
	}

	const byCreation = new Map();
	const ungroupedRecent = [];

	for (const n of recent) {
		const creationId = n.creation_id ?? null;
		const canCollapse = creationId != null && n.type && COLLAPSE_TYPES.has(n.type);

		if (canCollapse) {
			if (!byCreation.has(creationId)) {
				byCreation.set(creationId, []);
			}
			byCreation.get(creationId).push(n);
		} else {
			ungroupedRecent.push(n);
		}
	}

	const collapsed = [];
	for (const [, group] of byCreation) {
		group.sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
		// Only collapse when there are 2+ items; single items stay as individual notifications
		if (group.length === 1) {
			ungroupedRecent.push(group[0]);
			continue;
		}
		const latest = group[0];
		const commentCount = group.filter((n) => n.type === "comment" || n.type === "comment_thread").length;
		const tipCount = group.filter((n) => n.type === "tip").length;
		const allRead = group.every((n) => n.acknowledged_at);
		const unreadCount = group.filter((n) => !n.acknowledged_at).length;

		const creationTitle = typeof latest.creation_title === "string" && latest.creation_title.trim()
			? latest.creation_title.trim()
			: null;

		const parts = [];
		if (commentCount > 0) parts.push(commentCount === 1 ? "1 comment" : `${commentCount} comments`);
		if (tipCount > 0) parts.push(tipCount === 1 ? "1 tip" : `${tipCount} tips`);
		const activityText = parts.length ? parts.join(", ") : "New activity";
		// Message is just the activity summary; title already includes creation name, so don't repeat it
		const message = activityText;
		const title = creationTitle ? `Activity on "${creationTitle}"` : "Activity on your creation";

		collapsed.push({
			id: latest.id,
			title,
			message,
			link: latest.link,
			type: "creation_activity",
			created_at: latest.created_at,
			acknowledged_at: allRead ? latest.acknowledged_at : null,
			count: group.length,
			unread_count: unreadCount
		});
	}

	const unreadFirstThenCreated = (a, b) => {
		const aUnread = !a.acknowledged_at;
		const bUnread = !b.acknowledged_at;
		if (aUnread !== bUnread) return bUnread - aUnread; // unread first
		return (b.created_at || "").localeCompare(a.created_at || "");
	};
	collapsed.sort(unreadFirstThenCreated);
	const recentResult = [...collapsed, ...ungroupedRecent.map(stripForResponse)];
	recentResult.sort(unreadFirstThenCreated);
	const olderResult = older.map(stripForResponse);
	olderResult.sort(unreadFirstThenCreated);
	return [...recentResult, ...olderResult];
}

export { getCreationIdFromRow };
