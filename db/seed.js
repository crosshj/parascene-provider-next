import bcrypt from "bcryptjs";

// Seed data
const seedData = {
	users: [
		{
			email: "consumer@example.com",
			password: "p123@#",
			role: "consumer"
		},
		{
			email: "creator@example.com",
			password: "p123@#",
			role: "creator"
		},
		{
			email: "provider@example.com",
			password: "p123@#",
			role: "provider"
		},
		{
			email: "admin@example.com",
			password: "p123@#",
			role: "admin"
		}
	],

	moderation_queue: [
		{
			content_type: "creation",
			content_id: "post_1042",
			status: "pending",
			reason: "Possible spam links"
		},
		{
			content_type: "comment",
			content_id: "comment_221",
			status: "review",
			reason: "Reported for harassment"
		},
		{
			content_type: "profile",
			content_id: "creator_88",
			status: "resolved",
			reason: "Impersonation report"
		}
	],

	servers: [
		{
			name: "Parascene Home",
			server_url: "https://parascene-provider.vercel.app/api",
			status: "active",
			description: "Official Parascene system server",
			server_config: {
				methods: {
					gradientCircle: {
						name: "Gradient Circle",
						description: "Generates a 1024x1024 image with a gradient background using random colors at each corner and a random colored circle",
						credits: 2,
						fields: {},
					},
					centeredTextOnWhite: {
						name: "Centered Text on White",
						description: "Generates a 1024x1024 image with centered text rendered on a white background",
						credits: 0.5,
						fields: {
							text: {
								label: "Text",
								type: "text",
								required: true
							},
							color: {
								label: "Text Color",
								type: "color",
								required: false
							}
						}
					}
				}
			}
		}
	],

	policy_knobs: [
		{
			key: "content.flag.threshold",
			value: "3",
			description: "Reports required before auto-review"
		},
		{
			key: "provider.max.concurrent.jobs",
			value: "25",
			description: "Maximum concurrent jobs per provider"
		},
		{
			key: "creator.payout.minimum",
			value: "$50",
			description: "Minimum payout threshold"
		},
		{ key: "related.lineage_weight", value: "100", description: "Score for lineage (ancestor/child)." },
		{ key: "related.lineage_min_slots", value: "2", description: "Minimum lineage results in top N." },
		{ key: "related.same_server_method_weight", value: "80", description: "Score for same server+method." },
		{ key: "related.same_creator_weight", value: "50", description: "Score for same creator." },
		{ key: "related.fallback_weight", value: "20", description: "Score for recent published fill." },
		{ key: "related.transition_cap_k", value: "50", description: "Max destinations per from_id; evict by oldest last_updated when exceeded." },
		{ key: "related.transition_decay_half_life_days", value: "7", description: "Half-life in days for time decay when ranking." },
		{ key: "related.transition_window_days", value: "0", description: "If > 0, only use transitions within this many days (hard window)." },
		{ key: "related.random_slots_per_batch", value: "0", description: "If > 0, reserve this many slots per batch for random items." },
		{ key: "related.batch_size", value: "10", description: "Items per request / batch." },
		{ key: "related.candidate_cap_per_signal", value: "100", description: "Max candidates per signal before merge." },
		{ key: "related.recsys_weight", value: "50", description: "Weight for recsys when this creation has click-next data." },
		{ key: "related.semantic_weight", value: "50", description: "Weight for vector when click-next exists. 0 = semantic not used in blend." },
		{ key: "related.semantic_weight_no_click_next", value: "95", description: "When no click-next from this creation, strongly prefer semantic (0–100)." },
		{ key: "related.semantic_distance_max", value: "0.8", description: "Max cosine distance to include semantic neighbours (above = orthogonal/opposite, excluded)." }
	],

	notifications: [
		{
			audience: "role",
			role: "admin",
			title: "Moderation queue updated",
			message: "3 new items require review, including two flagged comments and one profile report that needs attention.",
			link: "/moderation"
		},
		{
			audience: "role",
			role: "creator",
			title: "Payout scheduled",
			message: "Your next payout is scheduled for Friday and includes earnings from the last two weeks of subscriptions.",
			link: "/earnings"
		},
		{
			audience: "role",
			role: "provider",
			title: "Capacity threshold reached",
			message: "Your provider node is at 85% capacity. Consider scaling up or pausing lower-priority jobs to maintain performance.",
			link: "/providers"
		},
		{
			audience: "role",
			role: "consumer",
			title: "New recommendations ready",
			message: "Check out new content tailored for you.",
			link: "/feed"
		},
		{
			audience: "user",
			email: "admin@example.com",
			title: "System health alert",
			message: "Latency spiked in EU region.",
			link: "/providers"
		},
		{
			audience: "user",
			email: "creator@example.com",
			title: "New subscriber",
			message: "You have a new subscriber this week.",
			link: "/profile"
		},
		{
			audience: "role",
			role: "admin",
			title: "Policy change pending",
			message: "Review the new policy knob updates before publishing to ensure they align with the latest compliance guidance.",
			link: "/policies"
		},
		{
			audience: "role",
			role: "admin",
			title: "Provider verification needed",
			message: "2 providers are awaiting verification.",
			link: "/providers"
		},
		{
			audience: "role",
			role: "creator",
			title: "Creation flagged",
			message: "One of your creations was flagged for review.",
			link: "/creations"
		},
		{
			audience: "role",
			role: "creator",
			title: "Weekly engagement summary",
			message: "Your views are up 12% week over week, with the biggest lift coming from the new tutorial series.",
			link: "/dashboard"
		},
		{
			audience: "role",
			role: "provider",
			title: "Maintenance window scheduled",
			message: "Planned maintenance on Sunday at 02:00 UTC. Expect brief interruptions while we apply security patches.",
			link: "/providers"
		},
		{
			audience: "role",
			role: "provider",
			title: "New region available",
			message: "APAC region now available for deployment.",
			link: "/providers"
		},
		{
			audience: "role",
			role: "consumer",
			title: "Account security tip",
			message: "Enable two-factor authentication for added security and sign-in alerts on your account.",
			link: "/profile"
		},
		{
			audience: "role",
			role: "consumer",
			title: "Trending creators",
			message: "Check out the creators trending this week.",
			link: "/explore"
		},
		{
			audience: "user",
			email: "provider@example.com",
			title: "Billing update",
			message: "Your billing statement is ready to view, including a breakdown of usage and storage costs.",
			link: "/billing"
		},
		{
			audience: "user",
			email: "consumer@example.com",
			title: "Welcome back",
			message: "We missed you. Here are new picks for you.",
			link: "/feed"
		}
	],

	feed_items: [
		{
			title: "Neon skyline study",
			summary: "A quick breakdown of the lighting setup used to get soft neon bounce in a rainy alley scene.",
			author: "Ari Kim",
			tags: "lighting,neon,city"
		},
		{
			title: "Foliage brush pack",
			summary: "A compact brush pack for fast foliage blocking with a focus on silhouette variety.",
			author: "Vale Studio",
			tags: "brushes,foliage,kit"
		},
		{
			title: "Motion tests: hover drones",
			summary: "Test passes for a hover drone rig with focus on stability and drift.",
			author: "K. Ramirez",
			tags: "animation,rigging,drones"
		}
	],

	feed_items_generated: {
		targetCount: 60,
		titles: [
			"City rain study",
			"Softbox portrait lighting",
			"Kitbash corridor pass",
			"Snow drift simulation",
			"Ocean shader tweaks",
			"Neon signage variants",
			"Studio turntable test",
			"Orbital camera motion",
			"Cloud layer stack",
			"Ruined temple blockout"
		],
		summaries: [
			"Notes on light falloff and wet surface reflections for a night scene.",
			"Small adjustments that improved skin tones under neutral key lighting.",
			"Exploring panel density and silhouette readability in a tight space.",
			"Quick sim pass focusing on drift speed and edge softness.",
			"Refining specular breakup for calmer water at dusk.",
			"Trying new glyph shapes and emissive bloom levels.",
			"Testing a clean material stack for consistent renders.",
			"A motion pass focused on smooth ease-in curves.",
			"Layering low, mid, and high clouds for depth.",
			"Blocking primary forms before detailing the set."
		],
		authors: [
			"Ari Kim",
			"Vale Studio",
			"K. Ramirez",
			"Jun Park",
			"Mila Ortiz",
			"S. Patel",
			"Nova Labs",
			"Cass Li",
			"Theo Grant",
			"Iris Chen"
		],
		tags: [
			"lighting",
			"materials",
			"animation",
			"environment",
			"procedural",
			"render",
			"workflow",
			"shaders",
			"simulation",
			"composition"
		]
	},

	explore_items: [
		{
			title: "Desert chapel render",
			summary: "Exploring minimalist architecture in a high noon desert environment.",
			category: "Architecture"
		},
		{
			title: "Clay study: portraits",
			summary: "A series of clay renders focused on material response under studio lighting.",
			category: "Portraits"
		},
		{
			title: "Procedural ruins",
			summary: "Testing a node-based workflow for generating ruined columns and debris.",
			category: "Procedural"
		}
	],

	creations: [
		{
			email: "creator@example.com",
			title: "Foggy bridge pass",
			body: "Uploaded a new pass with volumetric fog and soft backlighting. Looking for feedback on depth layering.",
			status: "published"
		},
		{
			email: "creator@example.com",
			title: "Shader notes: wet asphalt",
			body: "Collecting notes on the wet asphalt shader—mainly the roughness breakup and specular reflections.",
			status: "draft"
		},
		{
			email: "consumer@example.com",
			title: "Weekend kitbash",
			body: "A short kitbash session exploring industrial panels and greeble distribution.",
			status: "published"
		}
	],

	templates: [
		{
			name: "Moodboard Starter",
			category: "Pre-production",
			description: "A clean layout for collecting reference, color keys, and design notes."
		},
		{
			name: "Shot Breakdown",
			category: "Production",
			description: "Template for tracking shots, frame ranges, and dependencies."
		},
		{
			name: "Final Delivery Checklist",
			category: "Delivery",
			description: "A checklist for final exports, renders, and asset handoff."
		}
	]
};

export async function seedDatabase(dbInstance) {
	const { queries, seed } = dbInstance ?? {};
	if (!queries || !seed) {
		throw new Error("seedDatabase requires a db instance with queries and seed.");
	}

	try {
		// Seed users (with password hashing)
		await seed("users", seedData.users, {
			skipIfExists: true,
			checkExists: async () => await queries.selectUsers.all(),
			transform: (user) => ({
				email: user.email,
				password_hash: bcrypt.hashSync(user.password, 12),
				role: user.role
			})
		});

		// Seed moderation_queue
		await seed("moderation_queue", seedData.moderation_queue, {
			skipIfExists: true,
			checkExists: async () => await queries.selectModerationQueue.all()
		});


		// Seed policy_knobs
		await seed("policy_knobs", seedData.policy_knobs, {
			skipIfExists: true,
			checkExists: async () => await queries.selectPolicies.all()
		});

		// Seed notifications (with user_id lookups)
		const notificationsToSeed = [];
		for (const notification of seedData.notifications) {
			let userId = null;
			if (notification.audience === "user" && notification.email) {
				const user = await queries.selectUserByEmail.get(notification.email);
				userId = user?.id ?? null;
			}

			notificationsToSeed.push({
				user_id: userId,
				role: notification.audience === "role" ? notification.role : null,
				title: notification.title,
				message: notification.message,
				link: notification.link
			});
		}

		await seed("notifications", notificationsToSeed, {
			skipIfExists: true
		});

		// Seed explore_items
		await seed("explore_items", seedData.explore_items, {
			skipIfExists: true,
			checkExists: async () => await queries.selectExploreItems.all()
		});

		// Seed creations (with user_id lookups) - DISABLED: creations table not seeded
		// const creatorUser = await queries.selectUserByEmail.get("creator@example.com");
		// const consumerUser = await queries.selectUserByEmail.get("consumer@example.com");

		// const creationsToSeed = seedData.creations
		//   .map((creation) => {
		//     const userId =
		//       creation.email === "creator@example.com"
		//         ? creatorUser?.id
		//         : consumerUser?.id;
		//     if (!userId) return null;

		//     return {
		//       user_id: userId,
		//       title: creation.title,
		//       body: creation.body,
		//       status: creation.status
		//     };
		//   })
		//   .filter(Boolean);

		// await seed("creations", creationsToSeed, {
		//   skipIfExists: true
		// });


		// Seed servers (with user_id lookup)
		const adminUser = await queries.selectUserByEmail.get("admin@example.com");
		if (adminUser && seedData.servers) {
			const serversToSeed = seedData.servers.map(server => ({
				user_id: adminUser.id,
				name: server.name,
				server_url: server.server_url,
				status: server.status,
				description: server.description || null,
				members_count: 0,
				server_config: server.server_config || null
			}));
			await seed("servers", serversToSeed, {
				skipIfExists: true,
				checkExists: async () => await queries.selectServers.all()
			});
		}

		// Seed templates
		await seed("templates", seedData.templates, {
			skipIfExists: true,
			checkExists: async () => await queries.selectTemplates.all()
		});

		// console.log("Seed complete.");
	} catch (error) {
		// console.error("Seed error:", error);
		throw error;
	}
}
