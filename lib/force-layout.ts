/* A small force-directed layout (Fruchterman–Reingold with gravity), run once
 * when the graph loads. Deterministic: nodes start on a spiral in input order,
 * so the same graph always lays out the same way. */

export interface Point {
	x: number;
	y: number;
}

export function forceLayout(ids: string[], edges: { source: string; target: string }[], size = 1000): Map<string, Point> {
	const n = ids.length;
	const pos = new Map<string, Point>();
	if (n === 0) return pos;
	const index = new Map(ids.map((id, i) => [id, i]));
	const x = new Float64Array(n);
	const y = new Float64Array(n);
	for (let i = 0; i < n; i++) {
		const angle = i * 2.399963; // golden angle
		const r = (size / 2.5) * Math.sqrt((i + 0.5) / n);
		x[i] = Math.cos(angle) * r;
		y[i] = Math.sin(angle) * r;
	}
	const links = edges
		.map((e) => [index.get(e.source), index.get(e.target)] as const)
		.filter((l): l is readonly [number, number] => l[0] !== undefined && l[1] !== undefined && l[0] !== l[1]);

	const k = Math.sqrt((size * size) / n) * 0.55;
	const iterations = Math.min(400, Math.max(120, Math.round(60000 / n)));
	const dx = new Float64Array(n);
	const dy = new Float64Array(n);
	let temperature = size / 8;
	const cooling = temperature / (iterations + 1);

	for (let iter = 0; iter < iterations; iter++) {
		dx.fill(0);
		dy.fill(0);
		for (let i = 0; i < n; i++) {
			for (let j = i + 1; j < n; j++) {
				let ddx = x[i]! - x[j]!;
				let ddy = y[i]! - y[j]!;
				let d2 = ddx * ddx + ddy * ddy;
				if (d2 < 0.01) {
					ddx = 0.1 * ((i % 7) - 3);
					ddy = 0.1 * ((j % 5) - 2);
					d2 = ddx * ddx + ddy * ddy + 0.01;
				}
				const f = (k * k) / d2; // repulsion k²/d, applied along the unit vector
				dx[i]! += ddx * f;
				dy[i]! += ddy * f;
				dx[j]! -= ddx * f;
				dy[j]! -= ddy * f;
			}
		}
		for (const [a, b] of links) {
			const ddx = x[a]! - x[b]!;
			const ddy = y[a]! - y[b]!;
			const d = Math.sqrt(ddx * ddx + ddy * ddy) || 0.01;
			const f = d / k; // attraction d²/k along the unit vector
			dx[a]! -= ddx * f;
			dy[a]! -= ddy * f;
			dx[b]! += ddx * f;
			dy[b]! += ddy * f;
		}
		for (let i = 0; i < n; i++) {
			// Gravity keeps disconnected pieces from drifting away.
			dx[i]! -= x[i]! * 0.04;
			dy[i]! -= y[i]! * 0.04;
			const d = Math.sqrt(dx[i]! * dx[i]! + dy[i]! * dy[i]!) || 1;
			const step = Math.min(d, temperature);
			x[i]! += (dx[i]! / d) * step;
			y[i]! += (dy[i]! / d) * step;
		}
		temperature = Math.max(0.5, temperature - cooling);
	}
	for (let i = 0; i < n; i++) pos.set(ids[i]!, { x: x[i]!, y: y[i]! });
	return pos;
}
