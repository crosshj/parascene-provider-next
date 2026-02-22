/**
 * Returns a label for showing a user in notifications (in-app and digest).
 * Prefers display_name, then @user_name, then @email local part.
 * @param {{ display_name?: string | null, user_name?: string | null, email?: string | null }} user - user or merged user+profile
 * @param {{ display_name?: string | null, user_name?: string | null } | null} [profile] - optional profile (if user from selectUserById doesn't include it)
 * @returns {string}
 */
export function getNotificationDisplayName(user, profile = null) {
	const displayName =
		(typeof user?.display_name === "string" ? user.display_name.trim() : null) ||
		(typeof profile?.display_name === "string" ? profile.display_name.trim() : null);
	if (displayName) return displayName;

	const userName =
		(typeof user?.user_name === "string" ? user.user_name.trim() : null) ||
		(typeof profile?.user_name === "string" ? profile.user_name.trim() : null);
	if (userName) return `@${userName}`;

	const email = String(user?.email || "").trim();
	const localPart = email.includes("@") ? email.split("@")[0] : email;
	if (localPart) return `@${localPart}`;

	return "Someone";
}
