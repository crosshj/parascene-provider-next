// Character page — controls and SVG logic

const svg = document.querySelector('#characterImageColumn svg');
const pointsLine = document.getElementById('pointsLine');
const pointsLineMirror = document.getElementById('pointsLineMirror');

const BODY_FILL_STORAGE_KEY = 'character-body-fill';
const BODY_FILL_DEFAULT = '#475569';

function getStoredBodyFill() {
	try {
		const s = localStorage.getItem(BODY_FILL_STORAGE_KEY);
		if (s && /^#[0-9a-fA-F]{6}$/.test(s)) return s;
	} catch (_) {}
	return BODY_FILL_DEFAULT;
}

function setStoredBodyFill(hex) {
	try {
		localStorage.setItem(BODY_FILL_STORAGE_KEY, hex);
	} catch (_) {}
}

function applyBodyFillColor(hex) {
	const col = document.getElementById('characterImageColumn');
	if (col) col.style.setProperty('--character-body-fill', hex);
	const input = document.getElementById('bodyFillColor');
	if (input) input.value = hex;
	const valueEl = document.getElementById('bodyFillValue');
	if (valueEl) valueEl.textContent = hex;
}

function initBodyFillColor() {
	const input = document.getElementById('bodyFillColor');
	if (!input) return;
	const hex = getStoredBodyFill();
	applyBodyFillColor(hex);
	input.addEventListener('input', () => {
		const hex = input.value;
		applyBodyFillColor(hex);
		setStoredBodyFill(hex);
	});
}

const POINT_TYPES = ['corner', 'smooth', 'arc'];

function getPointType(point) {
	const t = point?.getAttribute('data-point-type');
	return POINT_TYPES.includes(t) ? t : 'corner';
}

function getArcStrength(point) {
	const v = parseFloat(point?.getAttribute('data-arc-strength'));
	return Number.isFinite(v) ? Math.max(0.1, Math.min(2, v)) : 0.5;
}

function setArcStrength(point, value) {
	if (!point || point.tagName !== 'circle') return;
	const v = Math.max(0.1, Math.min(2, Number(value)));
	point.setAttribute('data-arc-strength', String(v));
	updateLine();
	updatePointTypeUI();
}

function setPointType(point, type) {
	if (!point || point.tagName !== 'circle' || !POINT_TYPES.includes(type)) return;
	if (type === 'corner') {
		point.removeAttribute('data-point-type');
		point.removeAttribute('data-arc-strength');
	} else {
		point.setAttribute('data-point-type', type);
		if (type === 'arc') {
			if (!point.hasAttribute('data-arc-strength')) point.setAttribute('data-arc-strength', '0.5');
		} else {
			point.removeAttribute('data-arc-strength');
		}
	}
	updateLine();
	updatePointTypeUI();
}

/**
 * Chaikin's corner-cutting: one subdivision step for an open polyline.
 * Like subdivision surfaces in 3D — each segment becomes two, points move toward neighbors.
 * @param {{ x: number, y: number }[]} points
 * @returns {{ x: number, y: number }[]}
 */
function chaikinSubdivide(points) {
	if (points.length < 2) return [...points];
	const out = [points[0]];
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		out.push(
			{ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y },
			{ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y },
		);
	}
	out.push(points[points.length - 1]);
	return out;
}

function getSubdivisionLevel() {
	const el = document.getElementById('subdivisionLevel');
	const v = el ? parseInt(el.value, 10) : 0;
	return Number.isFinite(v) ? Math.max(0, Math.min(5, v)) : 0;
}

/** Recompute the path through all points in DOM order. Corner = straight segment, smooth = cubic Bezier through point. */
function updateLine() {
	if (!svg || !pointsLine) return;
	const elements = [...svg.querySelectorAll('circle')];
	let points = elements.map((p) => {
		const type = getPointType(p);
		return {
			x: parseFloat(p.getAttribute('cx')),
			y: parseFloat(p.getAttribute('cy')),
			type,
			arcStrength: type === 'arc' ? getArcStrength(p) : 0.5,
		};
	});
	// Apply subdivision (like subdivision surfaces): refine control polygon before drawing
	const subdivLevel = getSubdivisionLevel();
	for (let k = 0; k < subdivLevel; k++) {
		points = chaikinSubdivide(points.map((p) => ({ x: p.x, y: p.y }))).map((p) => ({
			...p,
			type: 'corner',
			arcStrength: 0.5,
		}));
	}
	if (points.length === 0) {
		pointsLine.setAttribute('d', '');
		if (pointsLineMirror) pointsLineMirror.setAttribute('d', '');
		return;
	}
	const allCorner = points.every((p) => p.type === 'corner');
	if (allCorner) {
		const d = points.map((p, i) => (i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`)).join(' ');
		pointsLine.setAttribute('d', d);
		if (pointsLineMirror) pointsLineMirror.setAttribute('d', d);
		return;
	}
	const n = points.length;
	const tension = 0.25;
	let d = `M ${points[0].x} ${points[0].y}`;
	let i = 0;
	while (i < n - 1) {
		const p0 = points[Math.max(0, i - 1)];
		const p1 = points[i];
		const p2 = points[i + 1];
		const p3 = points[Math.min(n - 1, i + 2)];
		if (p2.type === 'arc' && i + 2 < n) {
			// Run of consecutive arc points: skip all of them and draw one curve to the point after the run
			let k = 1;
			while (i + k + 1 < n && points[i + k + 1].type === 'arc') k += 1;
			const pFirstArc = points[i + 1];
			const pLastArc = points[i + k];
			const pEnd = points[i + k + 1];
			const s1 = pFirstArc.arcStrength;
			const s2 = pLastArc.arcStrength;
			const c1x = p1.x + s1 * (pFirstArc.x - p1.x);
			const c1y = p1.y + s1 * (pFirstArc.y - p1.y);
			const c2x = pEnd.x + s2 * (pLastArc.x - pEnd.x);
			const c2y = pEnd.y + s2 * (pLastArc.y - pEnd.y);
			d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${pEnd.x} ${pEnd.y}`;
			i += k + 1;
		} else if (p2.type === 'corner') {
			d += ` L ${p2.x} ${p2.y}`;
			i += 1;
		} else {
			const c1x = p1.x + tension * (p2.x - p0.x);
			const c1y = p1.y + tension * (p2.y - p0.y);
			const c2x = p2.x - tension * (p3.x - p1.x);
			const c2y = p2.y - tension * (p3.y - p1.y);
			d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
			i += 1;
		}
	}
	pointsLine.setAttribute('d', d);
	if (pointsLineMirror) pointsLineMirror.setAttribute('d', d);
}

/** @param {SVGSVGElement} svgEl @param {number} clientX @param {number} clientY */
function clientToSVG(svgEl, clientX, clientY) {
	const pt = svgEl.createSVGPoint();
	pt.x = clientX;
	pt.y = clientY;
	return pt.matrixTransform(svgEl.getScreenCTM().inverse());
}

let draggingPoint = null;

let selectedPoint = null;

function selectPoint(point) {
	if (!svg || !point || point.tagName !== 'circle') return;
	svg.querySelectorAll('circle').forEach((c) => c.classList.remove('selected'));
	point.classList.add('selected');
	selectedPoint = point;
	const section = document.getElementById('pointTypeSection');
	if (section) section.style.display = '';
	updatePointTypeUI();
}

function deselectPoint() {
	if (!selectedPoint) return;
	selectedPoint.classList.remove('selected');
	selectedPoint = null;
	const section = document.getElementById('pointTypeSection');
	if (section) section.style.display = 'none';
	updatePointTypeUI();
}

function updatePointTypeUI() {
	const cornerBtn = document.getElementById('pointTypeCorner');
	const smoothBtn = document.getElementById('pointTypeSmooth');
	const arcBtn = document.getElementById('pointTypeArc');
	const arcStrengthWrap = document.getElementById('arcStrengthWrap');
	const arcStrengthSlider = document.getElementById('arcStrengthSlider');
	const arcStrengthValue = document.getElementById('arcStrengthValue');
	if (!cornerBtn || !smoothBtn || !arcBtn) return;
	const type = selectedPoint ? getPointType(selectedPoint) : 'corner';
	cornerBtn.classList.toggle('active', type === 'corner');
	smoothBtn.classList.toggle('active', type === 'smooth');
	arcBtn.classList.toggle('active', type === 'arc');
	if (arcStrengthWrap) arcStrengthWrap.style.display = type === 'arc' ? '' : 'none';
	if (arcStrengthSlider && selectedPoint && type === 'arc') {
		arcStrengthSlider.value = String(getArcStrength(selectedPoint));
	}
	if (arcStrengthValue && selectedPoint && type === 'arc') {
		arcStrengthValue.textContent = String(getArcStrength(selectedPoint));
	}
}

function initPointDrag() {
	if (!svg) return;

	function onPointerDown(e) {
		if (e.target.tagName !== 'circle') return;
		e.preventDefault();
		draggingPoint = e.target;
		document.body.style.userSelect = 'none';
	}

	function onPointerMove(e) {
		if (!draggingPoint) return;
		const clientX = e.touches ? e.touches[0].clientX : e.clientX;
		const clientY = e.touches ? e.touches[0].clientY : e.clientY;
		const pt = clientToSVG(svg, clientX, clientY);
		const cx = Math.max(0, Math.min(1024, pt.x));
		const cy = Math.max(0, Math.min(1024, pt.y));
		draggingPoint.setAttribute('cx', String(cx));
		draggingPoint.setAttribute('cy', String(cy));
		updateLine();
	}

	function onPointerUp() {
		if (!draggingPoint) return;
		draggingPoint = null;
		document.body.style.userSelect = '';
		updateLine();
	}

	svg.addEventListener('click', (e) => {
		if (e.target.tagName === 'circle') selectPoint(e.target);
	});

	svg.addEventListener('mousedown', onPointerDown);
	svg.addEventListener('touchstart', onPointerDown, { passive: false });

	document.addEventListener('mousemove', onPointerMove);
	document.addEventListener('touchmove', onPointerMove, { passive: false });

	document.addEventListener('mouseup', onPointerUp);
	document.addEventListener('touchend', onPointerUp);
	document.addEventListener('mouseleave', onPointerUp);
}

initPointDrag();
initBodyFillColor();
updateLine();

let addMode = false;
const addPointBtn = document.getElementById('addPointBtn');

function setAddMode(on) {
	addMode = on;
	addPointBtn?.classList.toggle('active', on);
}

addPointBtn?.addEventListener('click', () => setAddMode(true));

const showPointsToggle = document.getElementById('showPointsToggle');
const characterImageColumn = document.getElementById('characterImageColumn');
showPointsToggle?.addEventListener('change', () => {
	if (characterImageColumn) {
		characterImageColumn.classList.toggle('points-hidden', !showPointsToggle.checked);
	}
});

document.getElementById('subdivisionLevel')?.addEventListener('change', () => updateLine());

function addPointAt(clientX, clientY) {
	if (!svg) return;
	const pt = clientToSVG(svg, clientX, clientY);
	const cx = Math.max(0, Math.min(1024, pt.x));
	const cy = Math.max(0, Math.min(1024, pt.y));
	const point = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
	point.setAttribute('cx', String(cx));
	point.setAttribute('cy', String(cy));
	svg.appendChild(point);
	updateLine();
}

svg?.addEventListener('click', (e) => {
	const isCanvas = e.target === svg || e.target.tagName === 'rect' || e.target === pointsLine;
	if (!isCanvas) return;
	if (addMode) {
		addPointAt(e.clientX, e.clientY);
		setAddMode(false);
	} else {
		deselectPoint();
	}
});

svg?.addEventListener('touchend', (e) => {
	const isCanvas = e.target === svg || e.target.tagName === 'rect' || e.target === pointsLine;
	if (!isCanvas || !e.changedTouches?.length) return;
	if (addMode) {
		const t = e.changedTouches[0];
		addPointAt(t.clientX, t.clientY);
		setAddMode(false);
	} else {
		deselectPoint();
	}
}, { passive: true });

document.getElementById('pointTypeCorner')?.addEventListener('click', () => {
	if (selectedPoint) setPointType(selectedPoint, 'corner');
});
document.getElementById('pointTypeSmooth')?.addEventListener('click', () => {
	if (selectedPoint) setPointType(selectedPoint, 'smooth');
});
document.getElementById('pointTypeArc')?.addEventListener('click', () => {
	if (selectedPoint) setPointType(selectedPoint, 'arc');
});

document.getElementById('arcStrengthSlider')?.addEventListener('input', (e) => {
	if (selectedPoint && getPointType(selectedPoint) === 'arc') {
		const v = parseFloat(e.target.value);
		setArcStrength(selectedPoint, v);
		document.getElementById('arcStrengthValue').textContent = String(v);
	}
});
