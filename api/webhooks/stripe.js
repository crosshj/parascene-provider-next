import "dotenv/config";
import Stripe from "stripe";
import { openDb } from "../../db/index.js";

const FOUNDER_CREDITS_GRANT = 700;

/** In-memory set of processed Stripe event ids (avoids double-apply in same instance; lost on cold start). */
const processedEventIds = new Set();

/**
 * Get raw request body for signature verification.
 * Supports Node IncomingMessage (stream) or Fetch-like request.
 */
async function getRawBody(req) {
	if (typeof req.text === "function") {
		return await req.text();
	}
	if (typeof req.arrayBuffer === "function") {
		const buf = await req.arrayBuffer();
		return Buffer.from(buf).toString("utf8");
	}
	if (req.on && typeof req.on === "function") {
		return await new Promise((resolve, reject) => {
			const chunks = [];
			req.on("data", (chunk) => chunks.push(chunk));
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});
	}
	return "";
}

/**
 * Grant Founder credits: ensure user has a credits row, then add FOUNDER_CREDITS_GRANT.
 */
async function grantFounderCredits(queries, userId) {
	const credits = await queries.selectUserCredits?.get(userId);
	if (!credits) {
		try {
			await queries.insertUserCredits?.run(userId, 0, null);
		} catch (e) {
			// Row may already exist from race
		}
	}
	if (queries.updateUserCreditsBalance?.run) {
		await queries.updateUserCreditsBalance.run(userId, FOUNDER_CREDITS_GRANT);
	}
}

export default async function handler(req, res) {
	res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
	res.setHeader("Pragma", "no-cache");
	res.setHeader("Expires", "0");

	if (req.method !== "POST") {
		return res.status(405).json({ error: "Method not allowed" });
	}

	const secret = process.env.STRIPE_WEBHOOK_SECRET;
	const stripeSecret = process.env.STRIPE_SECRET_KEY;
	if (!secret || !stripeSecret) {
		console.error("[Stripe Webhook] STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY not set");
		return res.status(503).json({ error: "Webhook not configured" });
	}

	let rawBody;
	try {
		rawBody = await getRawBody(req);
	} catch (e) {
		console.error("[Stripe Webhook] Failed to read raw body:", e);
		return res.status(400).json({ error: "Invalid body" });
	}

	const sig = req.headers["stripe-signature"];
	if (!sig) {
		return res.status(400).json({ error: "Missing stripe-signature" });
	}

	let event;
	try {
		const stripe = new Stripe(stripeSecret);
		event = stripe.webhooks.constructEvent(rawBody, sig, secret);
	} catch (err) {
		console.error("[Stripe Webhook] Signature verification failed:", err.message);
		return res.status(400).json({ error: "Invalid signature" });
	}

	// Idempotency: skip if we already handled this event in this instance
	if (processedEventIds.has(event.id)) {
		return res.status(200).json({ received: true });
	}

	try {
		const { queries } = await openDb();

		if (event.type === "checkout.session.completed") {
			const session = event.data?.object;
			const userId = session?.client_reference_id ? String(session.client_reference_id).trim() : null;
			if (!userId) {
				console.error("[Stripe Webhook] checkout.session.completed missing client_reference_id");
				return res.status(200).json({ received: true });
			}

			if (queries.updateUserPlan?.run) {
				await queries.updateUserPlan.run(userId, "founder");
			}
			const subId = session?.subscription
				? (typeof session.subscription === "string" ? session.subscription : session.subscription?.id)
				: null;
			if (subId && queries.updateUserStripeSubscriptionId?.run) {
				await queries.updateUserStripeSubscriptionId.run(userId, subId);
			}
			await grantFounderCredits(queries, userId);
			processedEventIds.add(event.id);
		}

		if (event.type === "customer.subscription.deleted") {
			const subscription = event.data?.object;
			const subscriptionId = subscription?.id;
			if (!subscriptionId || !queries.selectUserByStripeSubscriptionId?.get) {
				return res.status(200).json({ received: true });
			}
			const user = await queries.selectUserByStripeSubscriptionId.get(subscriptionId);
			if (!user) {
				return res.status(200).json({ received: true });
			}
			const userId = String(user.id);
			if (queries.updateUserPlan?.run) {
				await queries.updateUserPlan.run(userId, "free");
			}
			if (queries.updateUserStripeSubscriptionId?.run) {
				await queries.updateUserStripeSubscriptionId.run(userId, null);
			}
			processedEventIds.add(event.id);
		}

		if (event.type === "invoice.paid") {
			const invoice = event.data?.object;
			const billingReason = invoice?.billing_reason;
			// Only grant credits on recurring cycle, not on initial subscription (handled by checkout.session.completed)
			if (billingReason !== "subscription_cycle") {
				return res.status(200).json({ received: true });
			}
			const subscriptionId = typeof invoice?.subscription === "string" ? invoice.subscription : invoice?.subscription?.id;
			if (!subscriptionId || !queries.selectUserByStripeSubscriptionId?.get) {
				return res.status(200).json({ received: true });
			}
			const user = await queries.selectUserByStripeSubscriptionId.get(subscriptionId);
			if (!user) {
				return res.status(200).json({ received: true });
			}
			const userId = String(user.id);
			await grantFounderCredits(queries, userId);
			processedEventIds.add(event.id);
		}

		return res.status(200).json({ received: true });
	} catch (err) {
		console.error("[Stripe Webhook] Handler error:", err);
		return res.status(500).json({ error: "Webhook handler failed" });
	}
}
