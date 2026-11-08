// Overlapping refreshes can finish out of order; only the newest one started may publish its result.
export type LatestRequestGate = { begin(): number; isLatest(ticket: number): boolean };

export function latestRequestGate(): LatestRequestGate {
	let latest = 0;
	return {
		begin: () => ++latest,
		isLatest: ticket => ticket === latest,
	};
}
