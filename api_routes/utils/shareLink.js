import crypto from "crypto";

export const ACTIVE_SHARE_VERSION = "v1";

// Hard-coded (checked-in) share link registry. This is intentionally not “real security”.
// Revocation is handled by version rotation (disable v1, add v2, etc.).
export const SHARE_VERSIONS = {
	v1: {
		enabled: true,
		secret: "parascene-share-v1",
		sigBytes: 9
	}
};

function base64UrlEncode(buffer) {
	return Buffer.from(buffer)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/g, "");
}

function base64UrlDecode(value) {
	const s = String(value || "").trim();
	if (!s) return null;
	const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
	try {
		return Buffer.from(padded, "base64");
	} catch {
		return null;
	}
}

function hmacSha256(secret, data) {
	return crypto.createHmac("sha256", String(secret)).update(String(data)).digest();
}

function u24ToBufferBE(n) {
	const v = Number(n);
	if (!Number.isInteger(v) || v < 0 || v > 0xffffff) {
		throw new Error("u24 out of range");
	}
	return Buffer.from([(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff]);
}

function bufferToU24BE(buf, offset = 0) {
	return (buf[offset] << 16) | (buf[offset + 1] << 8) | buf[offset + 2];
}

export function mintShareToken({ version = ACTIVE_SHARE_VERSION, imageId, sharedByUserId }) {
	const cfg = SHARE_VERSIONS[version];
	if (!cfg || cfg.enabled !== true) {
		throw new Error("Share version disabled");
	}

	const payload = Buffer.concat([u24ToBufferBE(imageId), u24ToBufferBE(sharedByUserId)]);
	const p = base64UrlEncode(payload);
	const sig = hmacSha256(cfg.secret, p).subarray(0, cfg.sigBytes);
	const s = base64UrlEncode(sig);
	return `${p}.${s}`;
}

export function verifyShareToken({ version, token }) {
	const cfg = SHARE_VERSIONS[String(version || "")];
	if (!cfg || cfg.enabled !== true) {
		return { ok: false, error: "VERSION_DISABLED" };
	}

	const raw = String(token || "");
	const parts = raw.split(".");
	if (parts.length !== 2) return { ok: false, error: "INVALID_TOKEN" };
	const [p, s] = parts;
	if (!p || !s) return { ok: false, error: "INVALID_TOKEN" };

	const payload = base64UrlDecode(p);
	const sig = base64UrlDecode(s);
	if (!payload || payload.length !== 6) return { ok: false, error: "INVALID_PAYLOAD" };
	if (!sig || sig.length !== cfg.sigBytes) return { ok: false, error: "INVALID_SIG" };

	const expected = hmacSha256(cfg.secret, p).subarray(0, cfg.sigBytes);
	if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) {
		return { ok: false, error: "BAD_SIG" };
	}

	const imageId = bufferToU24BE(payload, 0);
	const sharedByUserId = bufferToU24BE(payload, 3);
	return { ok: true, imageId, sharedByUserId };
}

