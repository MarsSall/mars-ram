// Dates as day/month/year and 24-hour time, the same on every phone.
const pad = (n: number) => String(n).padStart(2, "0");

export function formatTime(timestamp: number): string {
	const d = new Date(timestamp);
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatDateTime(timestamp: number): string {
	const d = new Date(timestamp);
	return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${formatTime(timestamp)}`;
}

export type TimeAgo = { unit: "now" | "minutes" | "hours" | "days"; n: number };

/** How long ago, in the largest whole unit; a time ahead of the phone's clock counts as now. */
export function timeAgo(now: number, then: number): TimeAgo {
	const minutes = Math.floor(Math.max(0, now - then) / 60_000);
	if (minutes < 1) return { unit: "now", n: 0 };
	if (minutes < 60) return { unit: "minutes", n: minutes };
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return { unit: "hours", n: hours };
	return { unit: "days", n: Math.floor(hours / 24) };
}
