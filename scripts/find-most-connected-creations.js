#!/usr/bin/env node
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

function printUsage() {
	console.log(
		[
			'Find creations with the largest mutation families.',
			'',
			'Usage:',
			'  node scripts/find-most-connected-creations.js [--limit 20] [--min-descendants 1] [--json]',
			'',
			'Options:',
			'  --limit <n>         Max parent rows to print (default: 20)',
			'  --min-descendants <n>  Minimum published descendant count (default: 1)',
			'  --json              Print JSON instead of table',
			'  --help              Show this help'
		].join('\n')
	);
}

function parseArgs(argv) {
	const opts = {
		limit: 20,
		minDescendants: 1,
		json: false,
		help: false
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (arg === '--help' || arg === '-h') {
			opts.help = true;
			continue;
		}
		if (arg === '--json') {
			opts.json = true;
			continue;
		}
		if (arg === '--limit') {
			const next = Number.parseInt(argv[i + 1], 10);
			if (!Number.isFinite(next) || next < 1) {
				throw new Error('Invalid --limit value');
			}
			opts.limit = next;
			i++;
			continue;
		}
		if (arg === '--min-descendants') {
			const next = Number.parseInt(argv[i + 1], 10);
			if (!Number.isFinite(next) || next < 0) {
				throw new Error('Invalid --min-descendants value');
			}
			opts.minDescendants = next;
			i++;
			continue;
		}
		throw new Error(`Unknown argument: ${arg}`);
	}
	return opts;
}

function requireEnv(name) {
	const value = process.env[name];
	if (!value) throw new Error(`Missing required env var ${name}`);
	return value;
}

function toNumber(value) {
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

function pad(value, width) {
	const str = String(value);
	return str.length >= width ? str : str + ' '.repeat(width - str.length);
}

async function fetchMutatedRows(client) {
	const table = 'prsn_created_images';
	const rows = [];
	const pageSize = 1000;
	let from = 0;
	while (true) {
		const to = from + pageSize - 1;
		const { data, error } = await client
			.from(table)
			.select('id, user_id, title, published, meta, created_at')
			.not('meta->>mutate_of_id', 'is', null)
			.range(from, to);
		if (error) throw error;
		if (!data || data.length === 0) break;
		rows.push(...data);
		if (data.length < pageSize) break;
		from += data.length;
	}
	return rows;
}

async function fetchParentDetails(client, parentIds) {
	if (parentIds.length === 0) return [];
	const { data, error } = await client
		.from('prsn_created_images')
		.select('id, user_id, title, published, created_at')
		.in('id', parentIds);
	if (error) throw error;
	return data ?? [];
}

async function main() {
	const opts = parseArgs(process.argv.slice(2));
	if (opts.help) {
		printUsage();
		return;
	}

	const supabaseUrl = requireEnv('SUPABASE_URL');
	const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
	const client = createClient(supabaseUrl, serviceRoleKey);

	const mutatedRows = await fetchMutatedRows(client);
	const childrenByParent = new Map();
	const rowById = new Map();
	for (const row of mutatedRows) {
		const id = toNumber(row.id);
		if (id == null) continue;
		rowById.set(id, row);
	}

	for (const row of mutatedRows) {
		const parentId = toNumber(row?.meta?.mutate_of_id);
		if (parentId == null) continue;
		const childId = toNumber(row.id);
		if (childId == null) continue;
		const arr = childrenByParent.get(parentId) || [];
		arr.push(childId);
		childrenByParent.set(parentId, arr);
	}

	const parentIds = [...childrenByParent.keys()];
	const parentRows = await fetchParentDetails(client, parentIds);
	const parentById = new Map(parentRows.map((row) => [toNumber(row.id), row]));

	const ranked = parentIds
		.map((parentId) => {
			const visited = new Set();
			const queue = [...(childrenByParent.get(parentId) || [])];
			let publishedDescendants = 0;
			let samplePublishedDescendant = null;

			while (queue.length > 0) {
				const childId = queue.shift();
				if (childId == null || visited.has(childId)) continue;
				visited.add(childId);

				const childRow = rowById.get(childId);
				if (childRow?.published) {
					publishedDescendants += 1;
					if (samplePublishedDescendant == null) samplePublishedDescendant = childId;
				}

				const grandChildren = childrenByParent.get(childId) || [];
				for (const gc of grandChildren) {
					if (!visited.has(gc)) queue.push(gc);
				}
			}

			const parent = parentById.get(parentId) || null;
			return {
				parent_id: parentId,
				descendant_count: publishedDescendants,
				parent_title: parent?.title ?? null,
				parent_user_id: parent?.user_id ?? null,
				parent_published: parent?.published ?? null,
				parent_created_at: parent?.created_at ?? null,
				sample_descendant_id: samplePublishedDescendant
			};
		})
		.filter((row) => row.descendant_count >= opts.minDescendants)
		.sort((a, b) => b.descendant_count - a.descendant_count || b.parent_id - a.parent_id)
		.slice(0, opts.limit);

	if (opts.json) {
		console.log(JSON.stringify({
			generated_at: new Date().toISOString(),
			counting: 'published_descendants_only',
			min_descendants: opts.minDescendants,
			limit: opts.limit,
			total_parents: parentIds.length,
			rows: ranked
		}, null, 2));
		return;
	}

	console.log(`Most connected parents (by published descendants) | min_descendants=${opts.minDescendants} limit=${opts.limit}`);
	console.log('');
	console.log(
		[
			pad('parent_id', 10),
			pad('desc', 8),
			pad('parent_user', 11),
			pad('published', 9),
			pad('sample_desc', 12),
			'title'
		].join('  ')
	);
	console.log('-'.repeat(88));
	for (const row of ranked) {
		console.log(
			[
				pad(row.parent_id ?? '', 10),
				pad(row.descendant_count ?? '', 8),
				pad(row.parent_user_id ?? '', 11),
				pad(row.parent_published ?? '', 9),
				pad(row.sample_descendant_id ?? '', 12),
				String(row.parent_title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
			].join('  ')
		);
	}
	if (ranked.length === 0) {
		console.log('(no matching parents found)');
	}
}

main().catch((err) => {
	console.error(err.message || err);
	process.exitCode = 1;
});
