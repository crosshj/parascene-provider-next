import { getAvatarColor } from "../shared/avatar.js";
import { formatRelativeTime } from "../shared/datetime.js";
import { attachAutoGrowTextarea } from "../shared/autogrow.js";

const adminDataLoaded = {
	users: false,
	moderation: false,
	policies: false,
	todo: false,
	settings: false,
	sends: false,
	related: false
};
let todoWritable = true;
let todoPriorityMode = "gated";
let todoItemsCache = [];
let todoModalDependsOn = [];

function normalizeTodoMode(mode) {
	if (mode === "post") return "ratio";
	if (mode === "pre") return "gated";
	if (mode === "ratio" || mode === "impact" || mode === "cost") return mode;
	return "gated";
}

function buildTodoDependencyMap(items) {
	const map = new Map();
	for (const item of items || []) {
		const name = String(item?.name || "").trim();
		if (!name) continue;
		const dependsOn = Array.isArray(item?.dependsOn) ? item.dependsOn : [];
		map.set(name, dependsOn.map((dep) => String(dep || "").trim()).filter(Boolean));
	}
	return map;
}

function canReachDependency(from, target, map, visited = new Set()) {
	if (!from || !target) return false;
	if (from === target) return true;
	if (visited.has(from)) return false;
	visited.add(from);
	const deps = map.get(from) || [];
	for (const dep of deps) {
		if (canReachDependency(dep, target, map, visited)) return true;
	}
	return false;
}

function isAllowedDependency({ itemName, dependencyName }) {
	const name = String(itemName || "").trim();
	const dep = String(dependencyName || "").trim();
	if (!dep) return false;
	if (!name) return true; // can't validate cycles until we know the item name
	if (dep === name) return false;
	const map = buildTodoDependencyMap(todoItemsCache);
	// disallow if the candidate already depends (directly/transitively) on this item
	return !canReachDependency(dep, name, map);
}

function getDialColor(value) {
	const clamped = Math.max(0, Math.min(100, Number(value) || 0));
	let hue;
	if (clamped <= 20) {
		hue = 0;
	} else if (clamped <= 50) {
		const t = (clamped - 20) / 30;
		hue = 0 + t * 30;
	} else {
		const t = (clamped - 50) / 50;
		hue = 30 + t * 90;
	}
	return `hsl(${hue} 70% 50%)`;
}

function applyDialStyles(dial, value) {
	if (!dial) return;
	const dialColor = getDialColor(value);
	const dialPercent = Math.max(0, Math.min(100, Number(value) || 0));
	dial.textContent = value ?? "0";
	dial.style.setProperty("--dial-color", dialColor);
	dial.style.setProperty("--dial-percent", `${dialPercent}%`);
}

function renderEmpty(container, message) {
	const empty = document.createElement("div");
	empty.className = "admin-empty";
	empty.textContent = message;
	container.appendChild(empty);
}

function renderLoading(container, message = "Loading…") {
	const loading = document.createElement("div");
	loading.className = "admin-loading";
	loading.setAttribute("aria-live", "polite");
	loading.textContent = message;
	container.appendChild(loading);
}

function getUserDisplayName(user) {
	const displayName = String(user?.display_name || "").trim();
	if (displayName) return displayName;
	const userName = String(user?.user_name || "").trim();
	if (userName) return userName;
	const email = String(user?.email || "").trim();
	if (email) return email.split("@")[0] || email;
	if (user?.id) return `User ${user.id}`;
	return "User";
}

function getUserInitial(displayName) {
	const initial = String(displayName || "").trim().charAt(0).toUpperCase();
	return initial || "?";
}

function createUserAvatar(user) {
	const avatar = document.createElement("div");
	avatar.className = "user-avatar";
	const displayName = getUserDisplayName(user);
	const avatarUrl = typeof user?.avatar_url === "string" ? user.avatar_url.trim() : "";

	if (avatarUrl) {
		const img = document.createElement("img");
		img.src = avatarUrl;
		img.alt = displayName ? `Avatar for ${displayName}` : "User avatar";
		img.loading = "lazy";
		img.decoding = "async";
		avatar.appendChild(img);
	} else {
		const fallback = document.createElement("div");
		fallback.className = "user-avatar-fallback";
		fallback.textContent = getUserInitial(displayName);
		fallback.style.background = getAvatarColor(
			user?.user_name || user?.email || user?.id
		);
		fallback.setAttribute("aria-hidden", "true");
		avatar.appendChild(fallback);
	}

	return { avatar, displayName };
}

function renderError(container, message) {
	const error = document.createElement("div");
	error.className = "admin-error";
	error.textContent = message;
	container.appendChild(error);
}

const userModalComponent = document.querySelector("app-modal-user");
let currentUser = null;
let currentViewerUserId = null;

function escapeHtml(text) {
	const div = document.createElement("div");
	div.textContent = text;
	return div.innerHTML;
}

async function loadCurrentViewerUser() {
	try {
		const response = await fetch("/api/profile", { credentials: "include" });
		if (!response.ok) return;
		const data = await response.json();
		currentViewerUserId = Number(data?.id) || null;
	} catch {
		// ignore
	}
}

loadCurrentViewerUser();

function openUserModal(user) {
	if (!userModalComponent) return;
	currentUser = user;
	userModalComponent.open(user);
}

// Tip form handling is now in the app-modal-user component

async function loadUsers({ force = false } = {}) {
	const container = document.querySelector("#users-container");
	if (!container) return;
	if (adminDataLoaded.users && !force) return;

	try {
		const response = await fetch("/admin/users", {
			credentials: 'include'
		});
		if (!response.ok) throw new Error("Failed to load users.");
		const data = await response.json();

		container.innerHTML = "";
		if (!data.users || data.users.length === 0) {
			renderEmpty(container, "No users yet.");
			return;
		}

		for (const user of data.users) {
			const card = document.createElement("div");
			card.className = "card user-card";
			card.dataset.userId = String(user.id);
			card.tabIndex = 0;
			card.setAttribute("role", "button");
			const { avatar, displayName } = createUserAvatar(user);
			card.setAttribute("aria-label", `Open user ${displayName}`);
			card.addEventListener("click", () => openUserModal(user));
			card.addEventListener("keydown", (event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					openUserModal(user);
				}
			});

			const header = document.createElement("div");
			header.className = "user-card-header";

			const info = document.createElement("div");
			info.className = "user-card-info";

			const title = document.createElement("div");
			title.className = "user-title";

			const nameRow = document.createElement("div");
			nameRow.className = "user-name-row";
			const name = document.createElement("div");
			name.className = "user-name";
			name.textContent = displayName;
			nameRow.appendChild(name);
			const isSubscribed = user?.meta?.plan === "founder" || Boolean(user?.meta?.stripeSubscriptionId);
			if (isSubscribed) {
				const subBadge = document.createElement("span");
				subBadge.className = "user-card-badge user-card-badge-founder";
				subBadge.textContent = "Founder";
				nameRow.appendChild(subBadge);
			}
			title.appendChild(nameRow);

			if (user.email && user.email !== displayName) {
				const email = document.createElement("div");
				email.className = "user-email";
				email.textContent = user.email;
				title.appendChild(email);
			}

			const details = document.createElement("div");
			details.className = "user-meta";

			const userId = document.createElement("span");
			userId.className = "user-id";
			userId.textContent = `#${user.id}`;

			const role = document.createElement("span");
			role.className = "user-role";
			role.textContent = user.role;

			const credits = document.createElement("span");
			credits.className = "user-credits";
			const creditsValue = typeof user.credits === 'number' ? user.credits : 0;
			credits.textContent = `${creditsValue.toFixed(1)} credits`;

			details.appendChild(userId);
			details.appendChild(role);
			details.appendChild(credits);

			info.appendChild(title);
			info.appendChild(details);
			header.appendChild(avatar);
			header.appendChild(info);

			const createdLabel = formatRelativeTime(user.created_at, { style: "long" });
			const created = document.createElement("div");
			created.className = "user-created";
			created.textContent = createdLabel
				? `Joined ${createdLabel}`
				: (user.created_at || "—");

			const lastActiveLabel = user.last_active_at
				? formatRelativeTime(user.last_active_at, { style: "long" })
				: null;
			const lastActive = document.createElement("div");
			lastActive.className = "user-last-active";
			lastActive.textContent = lastActiveLabel
				? `Last active ${lastActiveLabel}`
				: "Last active —";

			card.appendChild(header);
			card.appendChild(created);
			card.appendChild(lastActive);

			container.appendChild(card);
		}
		adminDataLoaded.users = true;
	} catch (err) {
		container.innerHTML = "";
		renderError(container, "Error loading users.");
	}
}

async function loadModeration() {
	const container = document.querySelector("#moderation-container");
	if (!container) return;
	if (adminDataLoaded.moderation) return;

	try {
		const response = await fetch("/admin/moderation", {
			credentials: 'include'
		});
		if (!response.ok) throw new Error("Failed to load moderation queue.");
		const data = await response.json();

		container.innerHTML = "";
		if (!data.items || data.items.length === 0) {
			renderEmpty(container, "No moderation items.");
			return;
		}

		for (const item of data.items) {
			const card = document.createElement("div");
			card.className = "card admin-card";

			const title = document.createElement("div");
			title.className = "admin-title";
			title.textContent = `${item.content_type}: ${item.content_id}`;

			const meta = document.createElement("div");
			meta.className = "admin-meta";
			meta.textContent = `Status: ${item.status}`;

			const reason = document.createElement("div");
			reason.className = "admin-detail";
			reason.textContent = item.reason || "No reason provided.";

			const created = document.createElement("div");
			created.className = "admin-timestamp";
			created.textContent = item.created_at;

			card.appendChild(title);
			card.appendChild(meta);
			card.appendChild(reason);
			card.appendChild(created);

			container.appendChild(card);
		}
		adminDataLoaded.moderation = true;
	} catch (err) {
		container.innerHTML = "";
		renderError(container, "Error loading moderation.");
	}
}

let emailSendsPage = 1;
let emailSendsPageSize = 50;
let emailSendsTotal = 0;

async function loadEmailSends() {
	const container = document.querySelector("#email-sends-container");
	if (!container) return;

	container.innerHTML = "";
	renderLoading(container, "Loading sends…");

	try {
		const params = new URLSearchParams({
			limit: String(emailSendsPageSize),
			page: String(emailSendsPage)
		});
		const response = await fetch(`/admin/email-sends?${params}`, { credentials: "include" });
		if (!response.ok) throw new Error("Failed to load email sends.");
		const data = await response.json();

		container.innerHTML = "";
		const sends = data.sends ?? [];
		emailSendsTotal = Number(data.total) ?? 0;

		if (emailSendsTotal === 0) {
			renderEmpty(container, "No email sends yet. Run the cron to generate digest/welcome/nudge sends.");
			return;
		}

		const toolbar = document.createElement("div");
		toolbar.className = "admin-email-sends-toolbar";

		const pageSizeLabel = document.createElement("label");
		pageSizeLabel.className = "admin-email-sends-pagesize-label";
		pageSizeLabel.innerHTML = "Page size ";
		const pageSizeSelect = document.createElement("select");
		pageSizeSelect.className = "admin-email-sends-pagesize";
		pageSizeSelect.setAttribute("aria-label", "Sends per page");
		for (const n of [10, 50, 100]) {
			const opt = document.createElement("option");
			opt.value = String(n);
			opt.textContent = String(n);
			if (n === emailSendsPageSize) opt.selected = true;
			pageSizeSelect.appendChild(opt);
		}
		pageSizeLabel.appendChild(pageSizeSelect);
		toolbar.appendChild(pageSizeLabel);

		const start = emailSendsTotal === 0 ? 0 : (emailSendsPage - 1) * emailSendsPageSize + 1;
		const end = Math.min(emailSendsPage * emailSendsPageSize, emailSendsTotal);
		const total = Number(emailSendsTotal);
		const pageSize = Number(emailSendsPageSize);
		const page = Number(emailSendsPage);
		const noPrevPage = page <= 1;
		const noNextPage = total === 0 || page * pageSize >= total || sends.length < pageSize;

		const summary = document.createElement("span");
		summary.className = "admin-email-sends-summary";
		summary.textContent = `Showing ${start}–${end} of ${emailSendsTotal}`;
		toolbar.appendChild(summary);

		const nav = document.createElement("div");
		nav.className = "admin-email-sends-nav";
		nav.setAttribute("aria-label", "Pagination");
		const prevBtn = document.createElement("button");
		prevBtn.type = "button";
		prevBtn.className = "admin-email-sends-prev btn-secondary";
		prevBtn.textContent = "Previous";
		prevBtn.disabled = noPrevPage;
		nav.appendChild(prevBtn);

		const nextBtn = document.createElement("button");
		nextBtn.type = "button";
		nextBtn.className = "admin-email-sends-next btn-secondary";
		nextBtn.textContent = "Next";
		nextBtn.disabled = noNextPage;
		nav.appendChild(nextBtn);
		toolbar.appendChild(nav);

		pageSizeSelect.addEventListener("change", () => {
			emailSendsPageSize = Number(pageSizeSelect.value) || 50;
			emailSendsPage = 1;
			loadEmailSends();
		});
		prevBtn.addEventListener("click", () => {
			if (!noPrevPage) {
				emailSendsPage -= 1;
				loadEmailSends();
			}
		});
		nextBtn.addEventListener("click", () => {
			if (!noNextPage) {
				emailSendsPage += 1;
				loadEmailSends();
			}
		});

		const wrapper = document.createElement("div");
		wrapper.className = "admin-email-sends-wrapper";
		const table = document.createElement("table");
		table.className = "admin-table admin-email-sends-table";
		table.setAttribute("role", "grid");
		table.innerHTML = `
			<thead>
				<tr>
					<th scope="col" class="admin-table-col-date">Sent</th>
					<th scope="col" class="admin-table-col-email">User</th>
					<th scope="col" class="admin-table-col-campaign">Campaign</th>
					<th scope="col" class="admin-table-col-id">ID</th>
				</tr>
			</thead>
			<tbody></tbody>
		`;
		const tbody = table.querySelector("tbody");
		for (const row of sends) {
			const tr = document.createElement("tr");
			const sentAt = row.created_at ? formatRelativeTime(row.created_at, { style: "long" }) : "—";
			const userLabel = String(row.user_label ?? "").trim() || `#${row.user_id}`;
			const title = row.user_email ? escapeHtml(row.user_email) : userLabel;
			tr.innerHTML = `
				<td class="admin-table-col-date">${escapeHtml(sentAt)}</td>
				<td class="admin-table-col-email" title="${title}">${escapeHtml(userLabel)}</td>
				<td class="admin-table-col-campaign">${escapeHtml(String(row.campaign ?? ""))}</td>
				<td class="admin-table-col-id">${escapeHtml(String(row.id ?? ""))}</td>
			`;
			tbody.appendChild(tr);
		}
		wrapper.appendChild(table);
		container.appendChild(wrapper);
		container.appendChild(toolbar);
		adminDataLoaded.sends = true;
	} catch (err) {
		container.innerHTML = "";
		renderError(container, "Error loading email sends.");
	}
}

function setupEmailsTabPersistence() {
	const emailsPage = document.querySelector("#emails-page");
	if (!emailsPage) return;

	const tabsEl = emailsPage.querySelector("app-tabs");
	if (!tabsEl) return;

	const storageKey = "admin-emails-tab";
	const validTabIds = ["sends", "templates", "send", "settings"];

	// Restore saved tab on load
	const savedTab = (() => {
		try {
			const saved = sessionStorage.getItem(storageKey);
			return saved && validTabIds.includes(saved) ? saved : null;
		} catch {
			return null;
		}
	})();

	if (savedTab) {
		// Wait for tabs to be hydrated before setting active tab
		setTimeout(() => {
			if (typeof tabsEl.setActiveTab === "function") {
				tabsEl.setActiveTab(savedTab, { focus: false });
			}
		}, 0);
	}

	// Save tab on change
	tabsEl.addEventListener("tab-change", (e) => {
		const id = e.detail?.id;
		if (!id || !validTabIds.includes(id)) return;
		try {
			sessionStorage.setItem(storageKey, id);
		} catch {
			// Ignore storage errors
		}
	});
}

let algoTabPersistenceInitialized = false;

function setupAlgoTabPersistence() {
	const relatedPage = document.querySelector("#related-page");
	if (!relatedPage) return;

	const tabsEl = relatedPage.querySelector("app-tabs");
	if (!tabsEl) return;

	const storageKey = "admin-algo-tab";
	const validTabIds = ["transitions", "graph", "settings"];

	const savedTab = (() => {
		try {
			const saved = sessionStorage.getItem(storageKey);
			return saved && validTabIds.includes(saved) ? saved : null;
		} catch {
			return null;
		}
	})();

	if (savedTab) {
		setTimeout(() => {
			if (typeof tabsEl.setActiveTab === "function") {
				tabsEl.setActiveTab(savedTab, { focus: false });
			}
		}, 0);
	}

	if (!algoTabPersistenceInitialized) {
		algoTabPersistenceInitialized = true;
		tabsEl.addEventListener("tab-change", (e) => {
			const id = e.detail?.id;
			if (!id || !validTabIds.includes(id)) return;
			try {
				sessionStorage.setItem(storageKey, id);
			} catch {
				// Ignore storage errors
			}
			if (id === "graph") {
				const graphContainer = document.querySelector("#related-graph-container");
				if (graphContainer) loadRelatedGraph(graphContainer);
			}
		});
	}
}

let emailSendPanelInitialized = false;
let emailSendUserList = [];

function initEmailSendPanel() {
	const container = document.querySelector("#email-send-container");
	const form = document.getElementById("email-send-form");
	const statusEl = document.getElementById("email-send-status");
	const submitBtn = document.getElementById("email-send-submit");
	const recipientSelect = document.getElementById("email-send-recipient");
	const recipientSelected = document.getElementById("email-send-recipient-selected");
	const recipientManual = document.getElementById("email-send-recipient-manual");
	const toInput = document.getElementById("email-send-to");
	const recipientNameInput = document.getElementById("email-send-feedback-name");
	const templateSelect = document.getElementById("email-send-template");
	const feedbackField = document.getElementById("email-send-feedback-field");
	const feedbackOriginal = document.getElementById("email-send-feedback-original");
	const feedbackMessage = document.getElementById("email-send-feedback-message");
	const toDisplayEl = recipientSelected?.querySelector(".admin-email-send-to-display");
	if (!container || !form || !statusEl || !submitBtn || emailSendPanelInitialized) return;
	emailSendPanelInitialized = true;

	if (feedbackOriginal) attachAutoGrowTextarea(feedbackOriginal);
	if (feedbackMessage) attachAutoGrowTextarea(feedbackMessage);

	function setStatus(message, isError = false) {
		statusEl.textContent = message || "";
		statusEl.classList.toggle("admin-email-send-status-error", isError);
		statusEl.classList.toggle("admin-email-send-status-success", message && !isError);
	}

	function updateFeedbackFieldVisibility() {
		const isFeedback = (templateSelect?.value ?? "") === "featureRequestFeedback";
		if (feedbackField) feedbackField.hidden = !isFeedback;
		if (feedbackMessage) feedbackMessage.required = isFeedback;
	}

	function getFeedbackFormValues() {
		return {
			recipientName: (form.elements.recipientName?.value ?? "").trim(),
			originalRequest: (form.elements.originalRequest?.value ?? "").trim(),
			message: (form.elements.message?.value ?? "").trim()
		};
	}

	function getToAndRecipient() {
		const val = (recipientSelect?.value ?? "").trim();
		if (val === "manual" || val === "") {
			return {
				to: (form.elements.to?.value ?? "").trim(),
				recipientName: (form.elements.recipientName?.value ?? "").trim()
			};
		}
		const id = Number.parseInt(val, 10);
		if (!Number.isFinite(id)) return { to: "", recipientName: "" };
		const user = emailSendUserList.find((u) => u.id === id);
		if (!user) return { to: "", recipientName: "" };
		const username = String(user.user_name || "").trim();
		const recipientName = username ? `@${username}` : getUserDisplayName(user);
		return {
			to: String(user.email || "").trim(),
			recipientName
		};
	}

	function updateRecipientUI() {
		const val = (recipientSelect?.value ?? "").trim();
		if (val === "manual") {
			if (recipientSelected) recipientSelected.hidden = true;
			if (recipientManual) recipientManual.hidden = false;
			if (toInput) {
				toInput.removeAttribute("readonly");
				toInput.required = true;
			}
			if (recipientNameInput) recipientNameInput.removeAttribute("readonly");
			return;
		}
		if (val === "") {
			if (recipientSelected) recipientSelected.hidden = true;
			if (recipientManual) recipientManual.hidden = true;
			if (toInput) toInput.required = false;
			return;
		}
		const id = Number.parseInt(val, 10);
		if (!Number.isFinite(id)) return;
		const user = emailSendUserList.find((u) => u.id === id);
		if (!user) return;
		const email = String(user.email || "").trim();
		const username = String(user.user_name || "").trim();
		const nameForEmail = username ? `@${username}` : getUserDisplayName(user);
		if (toInput) {
			toInput.value = email;
			toInput.setAttribute("readonly", "readonly");
			toInput.required = false;
		}
		if (recipientNameInput) {
			recipientNameInput.value = nameForEmail;
			recipientNameInput.setAttribute("readonly", "readonly");
		}
		if (toDisplayEl) {
			toDisplayEl.textContent = `To: ${email}${username ? ` (@${username})` : ""}`;
		}
		if (recipientSelected) recipientSelected.hidden = false;
		if (recipientManual) recipientManual.hidden = true;
	}

	async function loadRecipientUsers() {
		if (!recipientSelect) return;
		try {
			const response = await fetch("/admin/users", { credentials: "include" });
			if (!response.ok) return;
			const data = await response.json();
			const active = Array.isArray(data.activeUsers) ? data.activeUsers : [];
			const other = Array.isArray(data.otherUsers) ? data.otherUsers : [];
			const all = [...active, ...other].filter((u) => u.role === "consumer" && !u.suspended);
			emailSendUserList = all.sort((a, b) => {
				const labelA = (getUserDisplayName(a) || String(a.email || "")).toLowerCase();
				const labelB = (getUserDisplayName(b) || String(b.email || "")).toLowerCase();
				return labelA.localeCompare(labelB, undefined, { sensitivity: "base" });
			});
			const manualOption = recipientSelect.querySelector('option[value="manual"]');
			emailSendUserList.forEach((user) => {
				const email = String(user.email || "").trim();
				const label = getUserDisplayName(user);
				const username = String(user.user_name || "").trim();
				const optionLabel = username ? `${label} (@${username}) · ${email}` : `${label} · ${email}`;
				const opt = document.createElement("option");
				opt.value = String(user.id);
				opt.textContent = optionLabel;
				recipientSelect.insertBefore(opt, manualOption);
			});
		} catch {
			// Ignore; user can still use "Enter manually"
		}
	}

	const validTemplateValues = new Set([
		"helloFromParascene", "commentReceived", "commentReceivedDelegated", "featureRequest",
		"featureRequestFeedback", "passwordReset", "digestActivity", "welcome",
		"firstCreationNudge", "reengagement", "creationHighlight", "supportReport"
	]);

	function restoreSavedSelection() {
		try {
			const savedTemplate = sessionStorage.getItem("admin-email-send-template");
			if (savedTemplate && validTemplateValues.has(savedTemplate) && templateSelect) {
				templateSelect.value = savedTemplate;
			}
			const savedRecipient = sessionStorage.getItem("admin-email-send-recipient");
			if (savedRecipient != null && recipientSelect) {
				const hasOption = Array.from(recipientSelect.options).some((o) => o.value === savedRecipient);
				if (hasOption) recipientSelect.value = savedRecipient;
			}
		} catch {
			// Ignore storage errors
		}
		updateRecipientUI();
		updateFeedbackFieldVisibility();
	}

	loadRecipientUsers().then(restoreSavedSelection);

	if (recipientSelect) {
		recipientSelect.addEventListener("change", () => {
			updateRecipientUI();
			try {
				sessionStorage.setItem("admin-email-send-recipient", recipientSelect.value ?? "");
			} catch {
				// Ignore
			}
		});
	}
	updateRecipientUI();

	if (templateSelect) {
		templateSelect.addEventListener("change", () => {
			updateFeedbackFieldVisibility();
			try {
				sessionStorage.setItem("admin-email-send-template", templateSelect.value ?? "");
			} catch {
				// Ignore
			}
		});
	}
	updateFeedbackFieldVisibility();

	form.addEventListener("submit", async (e) => {
		e.preventDefault();
		const { to, recipientName } = getToAndRecipient();
		const template = (form.elements.template?.value ?? "").trim();
		if (!to || !template) {
			setStatus("Please choose a recipient and select a template.", true);
			return;
		}
		if (template === "featureRequestFeedback") {
			const { originalRequest, message } = getFeedbackFormValues();
			if (!message) {
				setStatus("Please enter a reply for the Feature Request Feedback template.", true);
				return;
			}
		}
		submitBtn.disabled = true;
		submitBtn.classList.add("is-loading");
		setStatus("Sending…", false);
		try {
			const body = { to, template };
			if (template === "featureRequestFeedback") {
				const { originalRequest, message } = getFeedbackFormValues();
				body.recipientName = recipientName;
				body.originalRequest = originalRequest;
				body.message = message;
			}
			const response = await fetch("/admin/send-test-email", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(body)
			});
			const data = await response.json().catch(() => ({}));
			if (response.ok && data?.ok) {
				setStatus("Email sent.");
			} else {
				setStatus(data?.error || "Failed to send.", true);
			}
		} catch {
			setStatus("Failed to send.", true);
		} finally {
			submitBtn.disabled = false;
			submitBtn.classList.remove("is-loading");
		}
	});

	form.addEventListener("input", () => setStatus(""));
	form.addEventListener("change", () => setStatus(""));
}

async function loadEmailTemplates() {
	const container = document.querySelector("#email-templates-container");
	if (!container) return;

	container.innerHTML = "";
	renderLoading(container, "Loading templates…");

	try {
		// Get list of available templates from the templates export
		const templates = [
			{ name: "helloFromParascene", label: "Hello from parascene" },
			{ name: "commentReceived", label: "Comment received" },
			{ name: "commentReceivedDelegated", label: "Comment received (delegated)" },
			{ name: "featureRequest", label: "Feature request" },
			{ name: "featureRequestFeedback", label: "Feature Request Feedback" },
			{ name: "passwordReset", label: "Password reset" },
			{ name: "digestActivity", label: "Digest activity" },
			{ name: "welcome", label: "Welcome" },
			{ name: "firstCreationNudge", label: "First creation nudge" },
			{ name: "reengagement", label: "Re-engagement" },
			{ name: "creationHighlight", label: "Creation highlight" },
			{ name: "supportReport", label: "Support report" }
		];

		container.innerHTML = "";

		for (const template of templates) {
			const card = document.createElement("div");
			card.className = "admin-email-template-card";

			const header = document.createElement("div");
			header.className = "admin-email-template-header";
			const title = document.createElement("h4");
			title.className = "admin-email-template-title";
			title.textContent = template.label;
			header.appendChild(title);

			const iframeWrapper = document.createElement("div");
			iframeWrapper.className = "admin-email-template-iframe-wrapper";
			const iframe = document.createElement("iframe");
			iframe.className = "admin-email-template-iframe";
			iframe.src = `/admin/email-templates/${template.name}`;
			iframe.setAttribute("loading", "lazy");
			iframe.setAttribute("title", `Preview of ${template.label} email template`);
			iframeWrapper.appendChild(iframe);

			card.appendChild(header);
			card.appendChild(iframeWrapper);
			container.appendChild(card);
		}
	} catch (err) {
		container.innerHTML = "";
		renderError(container, "Error loading email templates.");
	}
}

async function loadPolicies() {
	const container = document.querySelector("#policies-container");
	if (!container) return;
	if (adminDataLoaded.policies) return;

	try {
		const response = await fetch("/admin/policies", {
			credentials: 'include'
		});
		if (!response.ok) throw new Error("Failed to load policies.");
		const data = await response.json();

		container.innerHTML = "";
		if (!data.policies || data.policies.length === 0) {
			renderEmpty(container, "No policies configured.");
			return;
		}

		for (const policy of data.policies) {
			const card = document.createElement("div");
			card.className = "card admin-card";

			const key = document.createElement("div");
			key.className = "admin-title";
			key.textContent = policy.key;

			const value = document.createElement("div");
			value.className = "admin-meta";
			value.textContent = policy.value;

			const description = document.createElement("div");
			description.className = "admin-detail";
			description.textContent = policy.description || "No description.";

			const updated = document.createElement("div");
			updated.className = "admin-timestamp";
			updated.textContent = policy.updated_at;

			card.appendChild(key);
			card.appendChild(value);
			card.appendChild(description);
			card.appendChild(updated);

			container.appendChild(card);
		}
		adminDataLoaded.policies = true;
	} catch (err) {
		container.innerHTML = "";
		renderError(container, "Error loading policies.");
	}
}

function renderTodoRows(container, items, writable) {
	container.innerHTML = "";
	const sortedItems = [...items].sort((a, b) => b.priority - a.priority);

	if (!sortedItems.length) {
		const item = document.createElement("div");
		item.className = "todo-loading";
		item.textContent = "No todo items yet.";
		container.appendChild(item);
	}

	sortedItems.forEach((item, index) => {
		const row = document.createElement("div");
		row.className = "todo-card";
		if (index === sortedItems.length - 1) {
			row.classList.add("todo-card-last");
		}
		row.dataset.itemName = item.name;
		row.dataset.itemDescription = item.description || "";
		row.dataset.itemTime = item.time;
		row.dataset.itemImpact = item.impact;
		row.dataset.itemDependsOn = JSON.stringify(Array.isArray(item.dependsOn) ? item.dependsOn : []);

		const card = document.createElement("div");
		card.className = "todo-card-inner";

		const header = document.createElement("div");
		header.className = "todo-card-header";

		const title = document.createElement("div");
		title.className = "todo-card-title";
		title.textContent = item.name;

		const description = document.createElement("div");
		description.className = "todo-card-description";
		description.textContent = item.description || "";

		const text = document.createElement("div");
		text.className = "todo-card-text";
		text.appendChild(title);
		text.appendChild(description);

		const dial = document.createElement("div");
		dial.className = "todo-card-dial";
		dial.textContent = item.priority;
		applyDialStyles(dial, item.priority);

		header.appendChild(text);
		header.appendChild(dial);

		card.appendChild(header);
		row.appendChild(card);
		container.appendChild(row);
	});

	if (writable) {
		const ghostRow = document.createElement("div");
		ghostRow.className = "todo-card todo-card-ghost";
		const ghostButton = document.createElement("button");
		ghostButton.type = "button";
		ghostButton.className = "todo-ghost";
		ghostButton.textContent = "Add new item";
		ghostButton.dataset.todoAdd = "true";
		ghostRow.appendChild(ghostButton);
		container.appendChild(ghostRow);
	}
}

async function loadTodo({ force = false, mode } = {}) {
	const body = document.querySelector("#todo-list");
	const alert = document.querySelector("#todo-alert");
	const modal = document.querySelector("#todo-modal");
	const modalForm = document.querySelector("#todo-modal-form");
	if (!body || !modal) return;
	if (adminDataLoaded.todo && !force) return;

	try {
		const priorityMode = normalizeTodoMode(mode ?? todoPriorityMode);
		const query = new URLSearchParams({ mode: priorityMode });
		const response = await fetch(`/api/todo?${query.toString()}`, {
			credentials: "include"
		});
		if (!response.ok) throw new Error("Failed to load todo.");
		const data = await response.json();
		const writable = data.writable !== false;
		todoWritable = writable;
		todoItemsCache = Array.isArray(data.items) ? data.items : [];
		renderTodoRows(body, todoItemsCache, writable);

		if (alert) {
			alert.hidden = writable;
		}
		body.querySelectorAll("button").forEach((el) => {
			el.disabled = !writable;
		});
		if (modalForm) {
			modalForm.querySelectorAll("input, textarea, button").forEach((el) => {
				el.disabled = !writable;
			});
		}
		adminDataLoaded.todo = true;
	} catch (err) {
		body.innerHTML = "";
		const item = document.createElement("div");
		item.className = "todo-loading";
		item.textContent = "Error loading todo.";
		body.appendChild(item);
	}
}

function syncSwitchAria(checkbox) {
	const wrapper = checkbox?.closest?.(".form-switch");
	if (wrapper) wrapper.setAttribute("aria-checked", String(!!checkbox?.checked));
}

function bindSwitch(checkbox, onSave) {
	if (!checkbox) return;
	const wrapper = checkbox.closest(".form-switch");
	syncSwitchAria(checkbox);
	wrapper?.addEventListener("click", (e) => {
		if (e.target === checkbox) return;
		e.preventDefault();
		checkbox.checked = !checkbox.checked;
		syncSwitchAria(checkbox);
		checkbox.dispatchEvent(new Event("change", { bubbles: true }));
	});
	checkbox.addEventListener("change", () => {
		syncSwitchAria(checkbox);
		onSave(checkbox.checked);
	});
}

/** Convert UTC time string (HH:MM or HH) to local time string (HH:MM). */
function utcToLocalTime(utcTimeStr) {
	const trimmed = String(utcTimeStr ?? "").trim();
	if (!trimmed) return "";
	const parts = trimmed.split(":");
	const hour = parseInt(parts[0], 10);
	if (!Number.isFinite(hour) || hour < 0 || hour > 23) return trimmed;
	const today = new Date();
	const utcDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), hour, parseInt(parts[1] || "0", 10) || 0));
	const localHour = utcDate.getHours();
	const localMin = utcDate.getMinutes();
	return `${String(localHour).padStart(2, "0")}:${String(localMin).padStart(2, "0")}`;
}

/** Convert comma-separated UTC times to comma-separated local times. */
function utcWindowsToLocal(utcWindowsStr) {
	if (!utcWindowsStr) return "";
	return utcWindowsStr
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map(utcToLocalTime)
		.join(", ");
}

/** Convert local time string (HH:MM or HH) to UTC time string (HH:MM). */
function localToUtcTime(localTimeStr) {
	const trimmed = String(localTimeStr ?? "").trim();
	if (!trimmed) return "";
	const parts = trimmed.split(":");
	const hour = parseInt(parts[0], 10);
	if (!Number.isFinite(hour) || hour < 0 || hour > 23) return trimmed;
	const today = new Date();
	const localDate = new Date(today.getFullYear(), today.getMonth(), today.getDate(), hour, parseInt(parts[1] || "0", 10) || 0);
	const utcHour = localDate.getUTCHours();
	const utcMin = localDate.getUTCMinutes();
	return `${String(utcHour).padStart(2, "0")}:${String(utcMin).padStart(2, "0")}`;
}

/** Convert comma-separated local times to comma-separated UTC times. */
function localWindowsToUtc(localWindowsStr) {
	if (!localWindowsStr) return "";
	return localWindowsStr
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean)
		.map(localToUtcTime)
		.join(",");
}

async function loadSettings() {
	if (adminDataLoaded.settings) return;

	const emailTestCheckbox = document.getElementById("email-use-test-recipient");
	const dryRunCheckbox = document.getElementById("email-dry-run");
	const digestWindowsInput = document.getElementById("digest-utc-windows");
	const maxDigestsInput = document.getElementById("max-digests-per-user-per-day");
	const digestActivityLookbackInput = document.getElementById("digest-activity-hours-lookback");
	const welcomeDelayInput = document.getElementById("welcome-email-delay-hours");
	const reengagementInactiveInput = document.getElementById("reengagement-inactive-days");
	const reengagementCooldownInput = document.getElementById("reengagement-cooldown-days");
	const highlightLookbackInput = document.getElementById("creation-highlight-lookback-hours");
	const highlightCooldownInput = document.getElementById("creation-highlight-cooldown-days");
	const highlightMinCommentsInput = document.getElementById("creation-highlight-min-comments");
	const settingsSaveBtn = document.getElementById("settings-save");
	if (!emailTestCheckbox) return;

	try {
		const response = await fetch("/admin/settings", { credentials: "include" });
		if (!response.ok) throw new Error("Failed to load settings.");
		const data = await response.json();
		emailTestCheckbox.checked = !!data.email_use_test_recipient;
		if (dryRunCheckbox) dryRunCheckbox.checked = !!data.email_dry_run;
		syncSwitchAria(emailTestCheckbox);
		syncSwitchAria(dryRunCheckbox);
		if (digestWindowsInput) {
			const utcWindows = data.digest_utc_windows ?? "";
			digestWindowsInput.value = utcWindows ? utcWindowsToLocal(utcWindows) : "";
		}
		if (maxDigestsInput) maxDigestsInput.value = String(data.max_digests_per_user_per_day ?? "2");
		if (digestActivityLookbackInput) digestActivityLookbackInput.value = String(data.digest_activity_hours_lookback ?? "24");
		if (welcomeDelayInput) welcomeDelayInput.value = String(data.welcome_email_delay_hours ?? "1");
		if (reengagementInactiveInput) reengagementInactiveInput.value = String(data.reengagement_inactive_days ?? "14");
		if (reengagementCooldownInput) reengagementCooldownInput.value = String(data.reengagement_cooldown_days ?? "30");
		if (highlightLookbackInput) highlightLookbackInput.value = String(data.creation_highlight_lookback_hours ?? "48");
		if (highlightCooldownInput) highlightCooldownInput.value = String(data.creation_highlight_cooldown_days ?? "7");
		if (highlightMinCommentsInput) highlightMinCommentsInput.value = String(data.creation_highlight_min_comments ?? "1");

		bindSwitch(emailTestCheckbox, async (next) => {
			const res = await fetch("/admin/settings", {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email_use_test_recipient: next })
			});
			if (!res.ok) {
				emailTestCheckbox.checked = !next;
				syncSwitchAria(emailTestCheckbox);
			}
		});

		bindSwitch(dryRunCheckbox, async (next) => {
			const res = await fetch("/admin/settings", {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ email_dry_run: next })
			});
			if (!res.ok && dryRunCheckbox) {
				dryRunCheckbox.checked = !next;
				syncSwitchAria(dryRunCheckbox);
			}
		});

		if (settingsSaveBtn) {
			const saveLabel = settingsSaveBtn.querySelector(".admin-settings-save-label");
			settingsSaveBtn.addEventListener("click", async () => {
				settingsSaveBtn.disabled = true;
				settingsSaveBtn.classList.add("is-loading");
				try {
					const localWindows = (digestWindowsInput?.value ?? "").trim();
					const utcWindows = localWindows ? localWindowsToUtc(localWindows) : "09:00,18:00";
					const payload = {
						digest_utc_windows: utcWindows,
						max_digests_per_user_per_day: Math.max(0, parseInt(maxDigestsInput?.value, 10) || 0),
						digest_activity_hours_lookback: Math.max(1, parseInt(digestActivityLookbackInput?.value, 10) || 24),
						welcome_email_delay_hours: Math.max(0, parseInt(welcomeDelayInput?.value, 10) || 0),
						reengagement_inactive_days: Math.max(1, parseInt(reengagementInactiveInput?.value, 10) || 14),
						reengagement_cooldown_days: Math.max(1, parseInt(reengagementCooldownInput?.value, 10) || 30),
						creation_highlight_lookback_hours: Math.max(1, parseInt(highlightLookbackInput?.value, 10) || 48),
						creation_highlight_cooldown_days: Math.max(1, parseInt(highlightCooldownInput?.value, 10) || 7),
						creation_highlight_min_comments: Math.max(0, parseInt(highlightMinCommentsInput?.value, 10) ?? 1)
					};
					const res = await fetch("/admin/settings", {
						method: "PATCH",
						credentials: "include",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(payload)
					});
					if (res.ok) {
						settingsSaveBtn.classList.remove("is-loading");
						if (saveLabel) saveLabel.textContent = "Saved";
						setTimeout(() => {
							settingsSaveBtn.disabled = false;
							if (saveLabel) saveLabel.textContent = "Save settings";
						}, 2000);
						return;
					}
				} finally {
					if (settingsSaveBtn.disabled && settingsSaveBtn.classList.contains("is-loading")) {
						settingsSaveBtn.classList.remove("is-loading");
						settingsSaveBtn.disabled = false;
						if (saveLabel) saveLabel.textContent = "Save settings";
					}
				}
			});
		}
		adminDataLoaded.settings = true;
	} catch (err) {
		// Optionally show error in container
	}
}

const RELATED_SETTINGS_FIELDS = [
	{ key: "related.recsys_weight", label: "Recsys weight (when click-next exists)", type: "number", section: "Recsys vs semantic", hint: "Recsys weight when click-next exists; blended with semantic." },
	{ key: "related.semantic_weight", label: "Semantic weight (when click-next exists)", type: "number", section: "Recsys vs semantic", hint: "Vector weight when click-next exists; 0 = disable semantic." },
	{ key: "related.semantic_weight_no_click_next", label: "Semantic weight when no click-next", type: "number", section: "Recsys vs semantic", hint: "When no click-next: e.g. 95 = 95% semantic, 5% recsys." },
	{ key: "related.semantic_distance_max", label: "Semantic distance max (cosine)", type: "number", section: "Recsys vs semantic", hint: "Max distance to include (0=same, 1=orthogonal); above = not similar." },
	{ key: "related.lineage_weight", label: "Lineage weight", type: "number", section: "Signal tuning", hint: "Score for parent/child lineage matches." },
	{ key: "related.lineage_min_slots", label: "Lineage min slots", type: "number", section: "Signal tuning", hint: "Min slots reserved for lineage per batch." },
	{ key: "related.same_server_method_weight", label: "Same server+method weight", type: "number", section: "Signal tuning", hint: "Same provider + method." },
	{ key: "related.same_creator_weight", label: "Same creator weight", type: "number", section: "Signal tuning", hint: "Score when created by same user." },
	{ key: "related.fallback_weight", label: "Fallback weight", type: "number", section: "Signal tuning", hint: "Score for random recent creations." },
	{ key: "related.transition_cap_k", label: "Transition cap (K per from)", type: "number", section: "Transition", hint: "Max destinations per source; oldest evicted." },
	{ key: "related.transition_decay_half_life_days", label: "Decay half-life (days)", type: "number", section: "Transition", hint: "Older transitions count less." },
	{ key: "related.transition_window_days", label: "Window (days, 0 = use decay)", type: "number", section: "Transition", hint: "Hard cutoff; 0 = use decay only." },
	{ key: "related.random_slots_per_batch", label: "Random slots per batch", type: "number", section: "Random & caps", hint: "Random items injected per batch." },
	{ key: "related.batch_size", label: "Batch size", type: "number", section: "Random & caps", hint: "Related items per request." },
	{ key: "related.candidate_cap_per_signal", label: "Candidate cap per signal", type: "number", section: "Random & caps", hint: "Max candidates per signal." }
];

let relatedTransitionsPage = 1;
const relatedTransitionsPageSize = 20;
const relatedTransitionsSortByDefault = "count";
const relatedTransitionsSortDirDefault = "desc";
let relatedTransitionsSortBy = relatedTransitionsSortByDefault;
let relatedTransitionsSortDir = relatedTransitionsSortDirDefault;

const RELATED_SECTION_ORDER = ["Recsys vs semantic", "Transition", "Random & caps", "Signal tuning"];
const RELATED_SECTION_DESCRIPTIONS = {
	"Recsys vs semantic": "Blend recsys with vector similarity; weights and distance max control the mix.",
	Transition: "Cap, decay, and optional window for recent clicks.",
	"Random & caps": "Random injection and candidate/batch pool size.",
	"Signal tuning": "Weights for lineage, same-creator, fallback when click-next is sparse."
};

async function renderRelatedSettingsForm(settingsContainer, data) {
	settingsContainer.innerHTML = "";
	settingsContainer.classList.add("admin-related-settings-grid");
	const bySection = new Map();
	for (const field of RELATED_SETTINGS_FIELDS) {
		const sec = field.section;
		if (!bySection.has(sec)) bySection.set(sec, []);
		bySection.get(sec).push(field);
	}
	for (const sectionTitle of RELATED_SECTION_ORDER) {
		const fields = bySection.get(sectionTitle);
		if (!fields?.length) continue;
		const title = document.createElement("span");
		title.className = "admin-settings-section-title";
		title.textContent = sectionTitle === "Transition" ? "Click-next transitions" : sectionTitle;
		settingsContainer.appendChild(title);
		const sectionHint = document.createElement("div");
		sectionHint.className = "admin-settings-field";
		sectionHint.style.gridColumn = "1 / -1";
		const sectionHintText = document.createElement("p");
		sectionHintText.className = "admin-detail admin-related-field-hint";
		sectionHintText.textContent = RELATED_SECTION_DESCRIPTIONS[sectionTitle] || "";
		sectionHint.appendChild(sectionHintText);
		settingsContainer.appendChild(sectionHint);
		for (const field of fields) {
			const wrap = document.createElement("div");
			wrap.className = "admin-settings-field";
			if (field.type === "checkbox") {
				const row = document.createElement("div");
				row.className = "admin-settings-row";
				const switchWrap = document.createElement("div");
				switchWrap.className = "form-switch admin-settings-switch";
				switchWrap.setAttribute("role", "switch");
				switchWrap.setAttribute("aria-label", field.label);
				const input = document.createElement("input");
				input.type = "checkbox";
				input.id = `related-${field.key.replace(/\./g, "-")}`;
				input.className = "form-switch-input";
				input.setAttribute("aria-hidden", "true");
				input.setAttribute("tabindex", "-1");
				input.dataset.relatedKey = field.key;
				input.checked = String(data[field.key] ?? "true").toLowerCase() === "true";
				switchWrap.appendChild(input);
				const track = document.createElement("span");
				track.className = "form-switch-track";
				track.innerHTML = "<span class=\"form-switch-thumb\"></span>";
				switchWrap.appendChild(track);
				row.appendChild(switchWrap);
				const labelDesc = document.createElement("div");
				labelDesc.className = "admin-settings-label-desc";
				const label = document.createElement("label");
				label.className = "admin-settings-label-inline";
				label.htmlFor = input.id;
				label.textContent = field.label;
				labelDesc.appendChild(label);
				if (field.hint) {
					const hint = document.createElement("p");
					hint.className = "admin-detail admin-related-field-hint";
					hint.textContent = field.hint;
					labelDesc.appendChild(hint);
				}
				row.appendChild(labelDesc);
				wrap.appendChild(row);
				settingsContainer.appendChild(wrap);
				bindSwitch(input, () => { });
			} else {
				const label = document.createElement("label");
				label.className = "admin-settings-label";
				label.setAttribute("for", `related-${field.key.replace(/\./g, "-")}`);
				label.textContent = field.label;
				wrap.appendChild(label);
				if (field.hint) {
					const hint = document.createElement("p");
					hint.className = "admin-detail admin-related-field-hint";
					hint.textContent = field.hint;
					wrap.appendChild(hint);
				}
				const input = document.createElement("input");
				input.type = field.type === "number" ? "number" : "text";
				input.id = `related-${field.key.replace(/\./g, "-")}`;
				input.className = "admin-settings-input admin-related-input";
				input.dataset.relatedKey = field.key;
				input.value = String(data[field.key] ?? "").trim();
				if (field.type === "number") input.min = "0";
				wrap.appendChild(input);
				settingsContainer.appendChild(wrap);
			}
		}
	}
	const actions = document.createElement("div");
	actions.className = "admin-settings-actions admin-related-save-bar";
	const saveBtn = document.createElement("button");
	saveBtn.type = "button";
	saveBtn.className = "btn-primary admin-settings-save";
	saveBtn.innerHTML = '<span class="admin-settings-save-label">Save changes</span><span class="admin-settings-save-spinner" aria-hidden="true"></span>';
	actions.appendChild(saveBtn);
	settingsContainer.appendChild(actions);
	const statusEl = document.createElement("div");
	statusEl.className = "admin-related-save-status";
	statusEl.setAttribute("role", "alert");
	statusEl.setAttribute("aria-live", "polite");
	settingsContainer.appendChild(statusEl);
	saveBtn.addEventListener("click", async () => {
		saveBtn.disabled = true;
		saveBtn.classList.add("is-loading");
		statusEl.textContent = "";
		const payload = {};
		for (const field of RELATED_SETTINGS_FIELDS) {
			const input = document.querySelector(`[data-related-key="${field.key}"]`);
			if (!input) continue;
			if (field.type === "checkbox") {
				payload[field.key] = input.checked ? "true" : "false";
			} else {
				payload[field.key] = String(input.value ?? "").trim();
			}
		}
		try {
			const res = await fetch("/admin/related-settings", {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload)
			});
			const resData = await res.json().catch(() => ({}));
			if (res.ok) {
				statusEl.textContent = "Saved.";
				statusEl.classList.remove("admin-related-save-status-error");
				setTimeout(() => { statusEl.textContent = ""; }, 2000);
			} else {
				statusEl.textContent = resData?.error || "Failed to save.";
				statusEl.classList.add("admin-related-save-status-error");
			}
		} catch {
			statusEl.textContent = "Failed to save.";
			statusEl.classList.add("admin-related-save-status-error");
		} finally {
			saveBtn.disabled = false;
			saveBtn.classList.remove("is-loading");
		}
	});
}

async function loadRelatedAlgorithm() {
	const settingsContainer = document.querySelector("#related-settings-container");
	const transitionsContainer = document.querySelector("#related-transitions-container");
	if (!settingsContainer || !transitionsContainer) return;
	// Always refresh the settings form when visiting Algo so new sections (e.g. Recsys vs semantic) appear
	settingsContainer.innerHTML = "";
	renderLoading(settingsContainer, "Loading related settings…");
	let data = {};
	try {
		const response = await fetch("/admin/related-settings", { credentials: "include" });
		if (!response.ok) {
			settingsContainer.innerHTML = "";
			renderError(settingsContainer, "Error loading related settings.");
			return;
		}
		data = await response.json();
	} catch {
		settingsContainer.innerHTML = "";
		renderError(settingsContainer, "Error loading related settings.");
		return;
	}
	settingsContainer.innerHTML = "";
	try {
		await renderRelatedSettingsForm(settingsContainer, data);
	} catch (err) {
		settingsContainer.innerHTML = "";
		renderError(settingsContainer, "Error loading related settings.");
		return;
	}
	if (!adminDataLoaded.related) {
		adminDataLoaded.related = true;
	}
	loadRelatedTransitions(transitionsContainer);
	try {
		if (sessionStorage.getItem("admin-algo-tab") === "graph") {
			const graphContainer = document.querySelector("#related-graph-container");
			if (graphContainer) loadRelatedGraph(graphContainer);
		}
	} catch {
		// ignore
	}
}

async function loadRelatedTransitions(container) {
	if (!container) return;
	container.innerHTML = "";
	renderLoading(container, "Loading transitions…");

	try {
		const params = new URLSearchParams({
			page: String(relatedTransitionsPage),
			limit: String(relatedTransitionsPageSize),
			sort_by: relatedTransitionsSortBy,
			sort_dir: relatedTransitionsSortDir
		});
		const response = await fetch(`/admin/transitions?${params}`, { credentials: "include" });
		if (!response.ok) throw new Error("Failed to load transitions.");
		const data = await response.json();

		container.innerHTML = "";
		const items = data.items ?? [];
		const total = Number(data.total) ?? 0;
		const page = Number(data.page) ?? 1;
		const limit = Number(data.limit) ?? relatedTransitionsPageSize;
		const hasMore = data.hasMore === true;

		if (total === 0) {
			renderEmpty(container, "No transition data yet. Click related cards on creation detail to record transitions.");
			return;
		}

		const toolbar = document.createElement("div");
		toolbar.className = "admin-email-sends-toolbar admin-related-transitions-toolbar";
		const start = total === 0 ? 0 : (page - 1) * limit + 1;
		const end = Math.min(page * limit, total);
		const summary = document.createElement("span");
		summary.className = "admin-email-sends-summary";
		summary.textContent = `Showing ${start}–${end} of ${total}`;
		toolbar.appendChild(summary);

		const nav = document.createElement("div");
		nav.className = "admin-email-sends-nav";
		nav.setAttribute("aria-label", "Pagination");
		const prevBtn = document.createElement("button");
		prevBtn.type = "button";
		prevBtn.className = "admin-email-sends-prev btn-secondary";
		prevBtn.textContent = "Previous";
		prevBtn.disabled = page <= 1;
		const nextBtn = document.createElement("button");
		nextBtn.type = "button";
		nextBtn.className = "admin-email-sends-next btn-secondary";
		nextBtn.textContent = "Next";
		nextBtn.disabled = !hasMore;
		nav.appendChild(prevBtn);
		nav.appendChild(nextBtn);
		toolbar.appendChild(nav);

		prevBtn.addEventListener("click", () => {
			if (page > 1) {
				relatedTransitionsPage = page - 1;
				loadRelatedTransitions(container);
			}
		});
		nextBtn.addEventListener("click", () => {
			if (hasMore) {
				relatedTransitionsPage = page + 1;
				loadRelatedTransitions(container);
			}
		});

		const wrapper = document.createElement("div");
		wrapper.className = "admin-email-sends-wrapper admin-related-transitions-wrapper";
		const table = document.createElement("table");
		table.className = "admin-table admin-email-sends-table admin-related-transitions-table";
		table.setAttribute("role", "grid");
		const columns = [
			{ key: "from_created_image_id", label: "From (ID)", className: "admin-table-col-from" },
			{ key: "to_created_image_id", label: "To (ID)", className: "admin-table-col-to" },
			{ key: "count", label: "Count", className: "admin-table-col-count" },
			{ key: "last_updated", label: "Last updated", className: "admin-table-col-date" }
		];
		const thead = document.createElement("thead");
		const headerRow = document.createElement("tr");
		for (const col of columns) {
			const th = document.createElement("th");
			th.scope = "col";
			th.className = col.className + " admin-table-sortable";
			th.dataset.sort = col.key;
			const isActive = relatedTransitionsSortBy === col.key;
			const arrow = isActive ? (relatedTransitionsSortDir === "asc" ? " \u2191" : " \u2193") : "";
			th.textContent = col.label + arrow;
			th.setAttribute("aria-sort", isActive ? (relatedTransitionsSortDir === "asc" ? "ascending" : "descending") : "none");
			th.addEventListener("click", () => {
				if (relatedTransitionsSortBy === col.key) {
					relatedTransitionsSortDir = relatedTransitionsSortDir === "desc" ? "asc" : "desc";
				} else {
					relatedTransitionsSortBy = col.key;
					relatedTransitionsSortDir = "desc";
				}
				relatedTransitionsPage = 1;
				loadRelatedTransitions(container);
			});
			headerRow.appendChild(th);
		}
		thead.appendChild(headerRow);
		table.appendChild(thead);
		const tbody = document.createElement("tbody");
		for (const row of items) {
			const tr = document.createElement("tr");
			const fromIdRaw = row.from_created_image_id;
			const toIdRaw = row.to_created_image_id;
			const fromId = Number.isFinite(Number(fromIdRaw)) && fromIdRaw != null
				? `<a href="/creations/${escapeHtml(String(fromIdRaw))}">${escapeHtml(String(fromIdRaw))}</a>`
				: escapeHtml(String(fromIdRaw ?? "—"));
			const toId = Number.isFinite(Number(toIdRaw)) && toIdRaw != null
				? `<a href="/creations/${escapeHtml(String(toIdRaw))}">${escapeHtml(String(toIdRaw))}</a>`
				: escapeHtml(String(toIdRaw ?? "—"));
			const count = row.count ?? "—";
			const lastUpdated = row.last_updated ? formatRelativeTime(row.last_updated, { style: "long" }) : "—";
			tr.innerHTML = `
				<td class="admin-table-col-from">${fromId}</td>
				<td class="admin-table-col-to">${toId}</td>
				<td class="admin-table-col-count">${escapeHtml(String(count))}</td>
				<td class="admin-table-col-date">${escapeHtml(lastUpdated)}</td>
			`;
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);
		wrapper.appendChild(table);
		container.appendChild(wrapper);
		container.appendChild(toolbar);
	} catch (err) {
		container.innerHTML = "";
		renderError(container, "Error loading transitions.");
	}
}

function applyForceDirectedLayout(nodes, edges, w, h) {
	const centerX = w / 2;
	const centerY = h / 2;
	const maxRadius = 0.42 * Math.min(w, h);

	const degreeByNode = new Map();
	for (const n of nodes) degreeByNode.set(n, 0);
	for (const e of edges) {
		degreeByNode.set(e.from, (degreeByNode.get(e.from) || 0) + 1);
		degreeByNode.set(e.to, (degreeByNode.get(e.to) || 0) + 1);
	}
	const maxDegree = Math.max(1, ...degreeByNode.values());

	const byDegree = [...nodes].sort((a, b) => (degreeByNode.get(b) || 0) - (degreeByNode.get(a) || 0));
	const initialRadius = 0.18 * Math.min(w, h);
	byDegree.forEach((n, i) => {
		const t = i / Math.max(byDegree.length - 1, 1);
		const r = initialRadius * t;
		const angle = (2 * Math.PI * i) / Math.max(byDegree.length, 1) + i * 0.7;
		n.x = centerX + r * Math.cos(angle);
		n.y = centerY + r * Math.sin(angle);
	});

	const repulsion = 500;
	const attraction = 0.06;
	const centerPullBase = 0.04;
	const iterations = 80;
	for (let iter = 0; iter < iterations; iter++) {
		for (let i = 0; i < nodes.length; i++) {
			for (let j = i + 1; j < nodes.length; j++) {
				const a = nodes[i];
				const b = nodes[j];
				const dx = b.x - a.x;
				const dy = b.y - a.y;
				const d = Math.sqrt(dx * dx + dy * dy) || 0.1;
				const f = repulsion / (d * d);
				const fx = (f * dx) / d;
				const fy = (f * dy) / d;
				a.x -= fx;
				a.y -= fy;
				b.x += fx;
				b.y += fy;
			}
		}
		for (const e of edges) {
			const dx = e.to.x - e.from.x;
			const dy = e.to.y - e.from.y;
			const d = Math.sqrt(dx * dx + dy * dy) || 0.1;
			const f = d * attraction * Math.min(e.count, 10);
			const fx = (f * dx) / d;
			const fy = (f * dy) / d;
			e.from.x += fx;
			e.from.y += fy;
			e.to.x -= fx;
			e.to.y -= fy;
		}
		for (const n of nodes) {
			const degree = degreeByNode.get(n) || 0;
			const centerWeight = 0.25 + 0.75 * (degree / maxDegree);
			const dx = centerX - n.x;
			const dy = centerY - n.y;
			const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
			const pull = centerPullBase * centerWeight * (1 + dist / 100);
			n.x += (dx / dist) * Math.min(pull * dist, dist * 0.18);
			n.y += (dy / dist) * Math.min(pull * dist, dist * 0.18);
			const r = Math.sqrt((n.x - centerX) ** 2 + (n.y - centerY) ** 2);
			if (r > maxRadius) {
				const scale = maxRadius / r;
				n.x = centerX + (n.x - centerX) * scale;
				n.y = centerY + (n.y - centerY) * scale;
			}
		}
	}
}

function applyCircularLayout(nodes, cx, cy, radius) {
	const n = nodes.length;
	nodes.forEach((node, i) => {
		const angle = (2 * Math.PI * i) / n - Math.PI / 2;
		node.x = cx + radius * Math.cos(angle);
		node.y = cy + radius * Math.sin(angle);
	});
}

async function loadRelatedGraph(container) {
	if (!container) return;
	container.innerHTML = "";
	renderLoading(container, "Loading graph…");

	try {
		const allItems = [];
		let page = 1;
		const limit = 100;
		while (true) {
			const params = new URLSearchParams({
				page: String(page),
				limit: String(limit),
				sort_by: "count",
				sort_dir: "desc"
			});
			const res = await fetch(`/admin/transitions?${params}`, { credentials: "include" });
			if (!res.ok) throw new Error("Failed to load transitions.");
			const data = await res.json();
			const items = data.items ?? [];
			allItems.push(...items);
			if (!data.hasMore || items.length < limit) break;
			page += 1;
		}

		if (allItems.length === 0) {
			container.innerHTML = "";
			renderEmpty(container, "No transition data yet. Click related cards on creation detail to record transitions.");
			return;
		}

		const nodeIds = new Set();
		for (const r of allItems) {
			if (r.from_created_image_id != null) nodeIds.add(Number(r.from_created_image_id));
			if (r.to_created_image_id != null) nodeIds.add(Number(r.to_created_image_id));
		}
		const nodes = Array.from(nodeIds).map((id) => ({ id, x: 0, y: 0 }));
		const nodeById = new Map(nodes.map((n) => [n.id, n]));
		const edges = allItems
			.map((r) => ({
				from: nodeById.get(Number(r.from_created_image_id)),
				to: nodeById.get(Number(r.to_created_image_id)),
				count: Number(r.count) || 1
			}))
			.filter((e) => e.from && e.to);

		const w = 800;
		const h = 400;
		const layoutCenterX = 400;
		const layoutCenterY = 200;
		const circleRadius = 160;

		function renderGraph(layoutAlgo) {
			if (layoutAlgo === "circular") {
				applyCircularLayout(nodes, layoutCenterX, layoutCenterY, circleRadius);
			} else {
				applyForceDirectedLayout(nodes, edges, w, h);
			}
			const padding = 50;
			let minX = Infinity;
			let minY = Infinity;
			let maxX = -Infinity;
			let maxY = -Infinity;
			for (const n of nodes) {
				minX = Math.min(minX, n.x);
				minY = Math.min(minY, n.y);
				maxX = Math.max(maxX, n.x);
				maxY = Math.max(maxY, n.y);
			}
			minX -= padding;
			minY -= padding;
			maxX += padding;
			maxY += padding;
			const vbW = maxX - minX || 1;
			const vbH = maxY - minY || 1;
			const r = 2;
			const lineEls = edges
				.map(
					(e) =>
						`<line x1="${e.from.x}" y1="${e.from.y}" x2="${e.to.x}" y2="${e.to.y}" class="admin-related-graph-edge"/>`
				)
				.join("");
			const nodeEls = nodes
				.map(
					(n) =>
						`<a href="/creations/${n.id}" class="admin-related-graph-node-link"><circle cx="${n.x}" cy="${n.y}" r="${r}" class="admin-related-graph-node" data-id="${escapeHtml(String(n.id))}"/></a>`
				)
				.join("");
			return {
				viewBox: { minX, minY, width: vbW, height: vbH },
				innerHTML: `<g class="admin-related-graph-edges">${lineEls}</g><g class="admin-related-graph-nodes">${nodeEls}</g>`
			};
		}

		let currentLayout = "force";
		let { viewBox: initialViewBox, innerHTML } = renderGraph(currentLayout);
		let currentViewBox = { ...initialViewBox, minX: initialViewBox.minX, minY: initialViewBox.minY, width: initialViewBox.width, height: initialViewBox.height };

		const toolbar = document.createElement("div");
		toolbar.className = "admin-related-graph-toolbar";
		const layoutLabel = document.createElement("label");
		layoutLabel.className = "admin-related-graph-layout-label";
		layoutLabel.textContent = "Layout ";
		const layoutSelect = document.createElement("select");
		layoutSelect.className = "admin-related-graph-layout-select";
		layoutSelect.innerHTML = "<option value=\"force\">Force-directed</option><option value=\"circular\">Circular</option>";
		layoutSelect.value = currentLayout;
		layoutLabel.appendChild(layoutSelect);
		toolbar.appendChild(layoutLabel);
		const resetBtn = document.createElement("button");
		resetBtn.type = "button";
		resetBtn.className = "btn-secondary admin-related-graph-reset";
		resetBtn.textContent = "Reset view";
		toolbar.appendChild(resetBtn);

		container.innerHTML = "";
		container.appendChild(toolbar);
		const graphWrap = document.createElement("div");
		graphWrap.className = "admin-related-graph-wrap";
		const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
		svg.setAttribute("class", "admin-related-graph-svg");
		svg.setAttribute("aria-label", "Click-next transitions graph");
		svg.setAttribute("viewBox", `${currentViewBox.minX} ${currentViewBox.minY} ${currentViewBox.width} ${currentViewBox.height}`);
		svg.innerHTML = innerHTML;
		graphWrap.appendChild(svg);

		const zoomControls = document.createElement("div");
		zoomControls.className = "admin-related-graph-zoom";
		zoomControls.setAttribute("aria-label", "Zoom");
		const zoomOutBtn = document.createElement("button");
		zoomOutBtn.type = "button";
		zoomOutBtn.className = "admin-related-graph-zoom-btn";
		zoomOutBtn.textContent = "−";
		zoomOutBtn.setAttribute("aria-label", "Zoom out");
		const zoomInBtn = document.createElement("button");
		zoomInBtn.type = "button";
		zoomInBtn.className = "admin-related-graph-zoom-btn";
		zoomInBtn.textContent = "+";
		zoomInBtn.setAttribute("aria-label", "Zoom in");
		zoomControls.appendChild(zoomOutBtn);
		zoomControls.appendChild(zoomInBtn);
		graphWrap.appendChild(zoomControls);
		container.appendChild(graphWrap);

		function setViewBox(vb) {
			currentViewBox = vb;
			svg.setAttribute("viewBox", `${vb.minX} ${vb.minY} ${vb.width} ${vb.height}`);
		}

		function zoomBy(factor) {
			const cx = currentViewBox.minX + currentViewBox.width / 2;
			const cy = currentViewBox.minY + currentViewBox.height / 2;
			const newW = currentViewBox.width * factor;
			const newH = currentViewBox.height * factor;
			setViewBox({
				...currentViewBox,
				minX: cx - newW / 2,
				minY: cy - newH / 2,
				width: newW,
				height: newH
			});
		}

		zoomInBtn.addEventListener("click", () => zoomBy(0.9));
		zoomOutBtn.addEventListener("click", () => zoomBy(1 / 0.9));

		resetBtn.addEventListener("click", () => {
			setViewBox({ ...initialViewBox, minX: initialViewBox.minX, minY: initialViewBox.minY, width: initialViewBox.width, height: initialViewBox.height });
		});

		layoutSelect.addEventListener("change", () => {
			currentLayout = layoutSelect.value;
			const out = renderGraph(currentLayout);
			initialViewBox = out.viewBox;
			setViewBox({ ...initialViewBox, minX: initialViewBox.minX, minY: initialViewBox.minY, width: initialViewBox.width, height: initialViewBox.height });
			svg.innerHTML = out.innerHTML;
		});

		let panStart = null;
		svg.addEventListener("mousedown", (e) => {
			if (e.button !== 0 || e.target.closest("a")) return;
			panStart = { screenX: e.clientX, screenY: e.clientY, minX: currentViewBox.minX, minY: currentViewBox.minY };
		});
		svg.addEventListener("mousemove", (e) => {
			if (!panStart) return;
			const scaleX = currentViewBox.width / svg.clientWidth;
			const scaleY = currentViewBox.height / svg.clientHeight;
			setViewBox({
				...currentViewBox,
				minX: panStart.minX - (e.clientX - panStart.screenX) * scaleX,
				minY: panStart.minY - (e.clientY - panStart.screenY) * scaleY
			});
		});
		svg.addEventListener("mouseup", () => { panStart = null; });
		svg.addEventListener("mouseleave", () => { panStart = null; });

		svg.style.cursor = "grab";
		svg.addEventListener("mousedown", () => { if (panStart) svg.style.cursor = "grabbing"; });
		svg.addEventListener("mouseup", () => { svg.style.cursor = "grab"; });
		svg.addEventListener("mouseleave", () => { svg.style.cursor = "grab"; });
	} catch (err) {
		container.innerHTML = "";
		renderError(container, "Error loading graph.");
	}
}

function handleAdminRouteChange(route) {
	const normalizedRoute = route === "policies"
		? "policy-knobs"
		: route;

	switch (normalizedRoute) {
		case "moderation":
			loadModeration();
			break;
		case "servers":
			// Unified app-route-servers component handles its own data loading.
			break;
		case "policy-knobs":
			loadPolicies();
			break;
		case "emails":
			setupEmailsTabPersistence();
			loadEmailSends();
			loadEmailTemplates();
			initEmailSendPanel();
			loadSettings();
			break;
		case "related":
			setupAlgoTabPersistence();
			loadRelatedAlgorithm();
			break;
		case "todo":
			loadTodo();
			break;
		case "users":
		default:
			loadUsers();
			break;
	}
}

const adminHeader = document.querySelector("app-navigation");
if (adminHeader) {
	adminHeader.addEventListener("route-change", (event) => {
		handleAdminRouteChange(event.detail?.route);
	});
}

const initialRoute =
	window.location.pathname === "/" || window.location.pathname === ""
		? "users"
		: window.location.pathname.slice(1);
handleAdminRouteChange(initialRoute);

const todoModal = document.querySelector("#todo-modal");
const todoModalForm = document.querySelector("#todo-modal-form");
const todoReadonlyModal = document.querySelector("#todo-readonly-modal");
const todoReadonlyTitle = document.querySelector("#todo-readonly-title");
const todoReadonlyDescription = document.querySelector("[data-todo-readonly-description]");
const todoReadonlyTimeDial = document.querySelector('[data-todo-readonly-dial="time"]');
const todoReadonlyImpactDial = document.querySelector('[data-todo-readonly-dial="impact"]');
const todoDependsRoot = document.querySelector("[data-todo-depends]");
const todoDependsSelect = document.querySelector("[data-todo-depends-select]");
const todoDependsAdd = document.querySelector("[data-todo-depends-add]");
const todoDependsList = document.querySelector("[data-todo-depends-list]");

function buildTodoDependencyOptions({ excludeName } = {}) {
	if (!todoDependsSelect) return;
	const exclude = String(excludeName || "").trim();
	const currentName = exclude;
	const names = todoItemsCache
		.map((item) => String(item?.name || "").trim())
		.filter((name) => {
			if (!name || name === exclude) return false;
			if (todoModalDependsOn.includes(name)) return false;
			return isAllowedDependency({ itemName: currentName, dependencyName: name });
		});
	names.sort((a, b) => a.localeCompare(b));

	todoDependsSelect.innerHTML = "";
	const placeholder = document.createElement("option");
	placeholder.value = "";
	placeholder.textContent = names.length ? "Select an item…" : "No other items";
	placeholder.disabled = true;
	placeholder.selected = true;
	todoDependsSelect.appendChild(placeholder);

	for (const name of names) {
		const option = document.createElement("option");
		option.value = name;
		option.textContent = name;
		todoDependsSelect.appendChild(option);
	}
	todoDependsSelect.disabled = names.length === 0;
}

function renderTodoDependsOn() {
	if (!todoDependsList) return;
	todoDependsList.innerHTML = "";

	for (const dep of todoModalDependsOn) {
		const pill = document.createElement("div");
		pill.className = "todo-depends-pill";
		pill.appendChild(document.createTextNode(dep));

		const remove = document.createElement("button");
		remove.type = "button";
		remove.className = "todo-depends-remove";
		remove.dataset.todoDependsRemove = dep;
		remove.setAttribute("aria-label", `Remove dependency ${dep}`);
		remove.textContent = "×";
		pill.appendChild(remove);

		todoDependsList.appendChild(pill);
	}

	if (todoModalForm?.elements?.dependsOn) {
		todoModalForm.elements.dependsOn.value = JSON.stringify(todoModalDependsOn);
	}
}

function setTodoDependsOn(next) {
	const seen = new Set();
	const cleaned = (Array.isArray(next) ? next : [])
		.map((d) => String(d || "").trim())
		.filter((d) => d.length > 0 && !seen.has(d) && (seen.add(d), true));

	const currentName = String(todoModalForm?.elements?.name?.value || "").trim();
	todoModalDependsOn = cleaned.filter((d) => {
		if (d === currentName) return false;
		return isAllowedDependency({ itemName: currentName, dependencyName: d });
	});
	renderTodoDependsOn();
	buildTodoDependencyOptions({ excludeName: currentName });
}

if (todoDependsAdd) {
	todoDependsAdd.addEventListener("click", () => {
		if (!todoDependsSelect || !todoModalForm) return;
		const selected = String(todoDependsSelect.value || "").trim();
		if (!selected) return;
		const currentName = String(todoModalForm.elements.name.value || "").trim();
		if (selected === currentName) return;
		if (!isAllowedDependency({ itemName: currentName, dependencyName: selected })) return;
		if (todoModalDependsOn.includes(selected)) return;
		setTodoDependsOn([...todoModalDependsOn, selected]);
		updateTodoSaveState();
	});
}

if (todoDependsList) {
	todoDependsList.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		const dep = target.dataset.todoDependsRemove;
		if (!dep) return;
		setTodoDependsOn(todoModalDependsOn.filter((d) => d !== dep));
		updateTodoSaveState();
	});
}

function openTodoModal({ mode, item }) {
	if (!todoModal || !todoModalForm) return;
	todoModal.classList.add("open");
	const submit = todoModal.querySelector(".todo-modal-submit");
	const deleteButton = todoModal.querySelector(".todo-modal-delete");
	const title = todoModal.querySelector("#todo-modal-title");
	if (submit) submit.textContent = mode === "edit" ? "Save changes" : "Add item";
	if (title) title.textContent = mode === "edit" ? "Edit Todo Item" : "Add Todo Item";
	if (deleteButton) {
		deleteButton.hidden = mode !== "edit";
	}

	todoModalForm.reset();
	todoModalForm.elements.mode.value = mode;
	todoModalForm.elements.originalName.value = item?.name || "";
	todoModalForm.elements.name.value = item?.name || "";
	todoModalForm.elements.description.value = item?.description || "";
	todoModalForm.elements.time.value = item?.time || 50;
	todoModalForm.elements.impact.value = item?.impact || 50;
	setTodoDependsOn(Array.isArray(item?.dependsOn) ? item.dependsOn : []);
	todoModalForm.dataset.initial = JSON.stringify({
		name: todoModalForm.elements.name.value,
		description: todoModalForm.elements.description.value,
		time: String(todoModalForm.elements.time.value),
		impact: String(todoModalForm.elements.impact.value),
		dependsOn: todoModalForm.elements.dependsOn?.value || "[]"
	});
	updateTodoSaveState();
	updateTodoSliderValues();
}

function closeTodoModal() {
	if (!todoModal) return;
	todoModal.classList.remove("open");
}

function openTodoReadonlyModal(item) {
	if (!todoReadonlyModal) return;
	if (todoReadonlyTitle) {
		todoReadonlyTitle.textContent = item?.name || "Todo item";
	}
	if (todoReadonlyDescription) {
		todoReadonlyDescription.textContent = item?.description || "No description provided.";
	}
	applyDialStyles(todoReadonlyTimeDial, item?.time ?? 0);
	applyDialStyles(todoReadonlyImpactDial, item?.impact ?? 0);
	todoReadonlyModal.classList.add("open");
}

function closeTodoReadonlyModal() {
	if (!todoReadonlyModal) return;
	todoReadonlyModal.classList.remove("open");
}

if (todoModal) {
	todoModal.addEventListener("click", (event) => {
		if (event.target?.dataset?.todoClose !== undefined || event.target === todoModal) {
			closeTodoModal();
		}
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && todoModal.classList.contains("open")) {
			closeTodoModal();
		}
	});
}

if (todoReadonlyModal) {
	todoReadonlyModal.addEventListener("click", (event) => {
		if (event.target?.dataset?.todoReadonlyClose !== undefined || event.target === todoReadonlyModal) {
			closeTodoReadonlyModal();
		}
	});
	document.addEventListener("keydown", (event) => {
		if (event.key === "Escape" && todoReadonlyModal.classList.contains("open")) {
			closeTodoReadonlyModal();
		}
	});
}

const todoList = document.querySelector("#todo-list");
if (todoList) {
	todoList.addEventListener("click", (event) => {
		const target = event.target;
		if (!(target instanceof HTMLElement)) return;
		if (target.dataset.todoAdd !== undefined) {
			openTodoModal({ mode: "add" });
			return;
		}
		const card = target.closest(".todo-card");
		if (card && !card.querySelector(".todo-ghost")) {
			if (!todoWritable) {
				openTodoReadonlyModal({
					name: card.dataset.itemName,
					description: card.dataset.itemDescription,
					time: card.dataset.itemTime,
					impact: card.dataset.itemImpact
				});
				return;
			}
			openTodoModal({
				mode: "edit",
				item: {
					name: card.dataset.itemName,
					description: card.dataset.itemDescription,
					time: card.dataset.itemTime,
					impact: card.dataset.itemImpact,
					dependsOn: JSON.parse(card.dataset.itemDependsOn || "[]")
				}
			});
		}
	});
}

const todoModeToggle = document.querySelector("[data-todo-mode-toggle]");
const todoModeButtons = todoModeToggle
	? Array.from(todoModeToggle.querySelectorAll("[data-todo-mode]"))
	: [];

function setTodoPriorityMode(mode) {
	todoPriorityMode = normalizeTodoMode(mode);
	todoModeButtons.forEach((button) => {
		const isActive = button.dataset.todoMode === todoPriorityMode;
		button.classList.toggle("is-active", isActive);
		button.setAttribute("aria-pressed", String(isActive));
	});
}

if (todoModeButtons.length) {
	setTodoPriorityMode(todoPriorityMode);
	todoModeButtons.forEach((button) => {
		button.addEventListener("click", () => {
			const nextMode = normalizeTodoMode(button.dataset.todoMode);
			if (nextMode === todoPriorityMode) return;
			setTodoPriorityMode(nextMode);
			adminDataLoaded.todo = false;
			loadTodo({ force: true, mode: todoPriorityMode });
		});
	});
}

if (todoModalForm) {
	todoModalForm.addEventListener("submit", async (event) => {
		event.preventDefault();
		if (todoModalForm.querySelector(".todo-modal-submit")?.disabled) {
			return;
		}
		const payload = {
			name: todoModalForm.elements.name.value,
			description: todoModalForm.elements.description.value,
			time: Number(todoModalForm.elements.time.value),
			impact: Number(todoModalForm.elements.impact.value),
			dependsOn: todoModalDependsOn
		};
		const mode = todoModalForm.elements.mode.value;
		if (mode === "edit") {
			payload.originalName = todoModalForm.elements.originalName.value;
		}

		try {
			const response = await fetch("/api/todo", {
				method: mode === "edit" ? "PUT" : "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
				credentials: "include"
			});
			if (!response.ok) {
				const error = await response.json().catch(() => ({}));
				throw new Error(error.error || "Failed to save todo item.");
			}
			closeTodoModal();
			adminDataLoaded.todo = false;
			loadTodo({ force: true, mode: todoPriorityMode });
		} catch (err) {
			alert(err.message || "Failed to save todo item.");
		}
	});
}

const todoDeleteButton = document.querySelector(".todo-modal-delete");
if (todoDeleteButton) {
	todoDeleteButton.addEventListener("click", async () => {
		if (!todoModalForm) return;
		const name = todoModalForm.elements.originalName.value;
		if (!name) return;
		const confirmed = window.confirm(`Delete "${name}"?`);
		if (!confirmed) return;
		try {
			const response = await fetch("/api/todo", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ name }),
				credentials: "include"
			});
			if (!response.ok) {
				const error = await response.json().catch(() => ({}));
				throw new Error(error.error || "Failed to delete todo item.");
			}
			closeTodoModal();
			adminDataLoaded.todo = false;
			loadTodo({ force: true, mode: todoPriorityMode });
		} catch (err) {
			alert(err.message || "Failed to delete todo item.");
		}
	});
}

function updateTodoSliderValues() {
	if (!todoModalForm) return;
	const costValue = todoModalForm.querySelector('[data-slider-value="time"]');
	const impactValue = todoModalForm.querySelector('[data-slider-value="impact"]');
	if (costValue) costValue.textContent = todoModalForm.elements.time.value;
	if (impactValue) impactValue.textContent = todoModalForm.elements.impact.value;
}

function updateTodoSaveState() {
	if (!todoModalForm) return;
	const submit = todoModalForm.querySelector(".todo-modal-submit");
	if (!submit) return;
	const initial = todoModalForm.dataset.initial
		? JSON.parse(todoModalForm.dataset.initial)
		: null;
	const current = {
		name: todoModalForm.elements.name.value,
		description: todoModalForm.elements.description.value,
		time: String(todoModalForm.elements.time.value),
		impact: String(todoModalForm.elements.impact.value),
		dependsOn: todoModalForm.elements.dependsOn?.value || "[]"
	};
	const hasChanges = !initial
		|| initial.name !== current.name
		|| initial.description !== current.description
		|| initial.time !== current.time
		|| initial.impact !== current.impact
		|| initial.dependsOn !== current.dependsOn;
	submit.disabled = !hasChanges;
}

if (todoModalForm) {
	todoModalForm.addEventListener("input", (event) => {
		const target = event.target;
		if (target instanceof HTMLInputElement && (target.name === "time" || target.name === "impact")) {
			updateTodoSliderValues();
		}
		if (target instanceof HTMLInputElement && target.name === "name") {
			setTodoDependsOn(todoModalDependsOn);
		}
		updateTodoSaveState();
	});
	todoModalForm.addEventListener("change", () => {
		updateTodoSaveState();
	});
}

// Legacy server admin modal and provider registry logic has been removed.