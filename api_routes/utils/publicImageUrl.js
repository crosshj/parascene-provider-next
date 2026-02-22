/**
 * Build a publicly accessible share URL for a creation image.
 * Used when the provider (or Replicate) needs to fetch the image; same URL pattern as in create.js.
 * Can be used from scripts or API.
 */
import { ACTIVE_SHARE_VERSION, mintShareToken } from "./shareLink.js";

/**
 * @param {number} imageId - created_images.id
 * @param {number} sharedByUserId - user_id of the creator (used for token)
 * @param {string} baseUrl - app origin, e.g. from getBaseAppUrlForEmail()
 * @returns {string|null} Full URL to the share image endpoint, or null if token mint fails
 */
export function buildPublicImageUrl(imageId, sharedByUserId, baseUrl) {
	const id = Number(imageId);
	const uid = Number(sharedByUserId);
	if (!Number.isFinite(id) || id <= 0 || !Number.isFinite(uid) || uid <= 0) return null;
	try {
		const token = mintShareToken({
			version: ACTIVE_SHARE_VERSION,
			imageId: id,
			sharedByUserId: uid
		});
		const base = (baseUrl || "").replace(/\/$/, "");
		return `${base}/api/share/${encodeURIComponent(ACTIVE_SHARE_VERSION)}/${encodeURIComponent(token)}/image`;
	} catch {
		return null;
	}
}
