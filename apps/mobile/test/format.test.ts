import { describe, expect, it } from "vitest";
import { formatDateTime, formatTime, timeAgo } from "../src/ui/format";

describe("formatDateTime", () => {
	it("uses a 24-hour clock", () => {
		expect(formatDateTime(new Date(2026, 9, 20, 19, 27, 17).getTime())).toBe("20/10/2026 19:27");
	});

	it("pads single digits", () => {
		expect(formatDateTime(new Date(2026, 0, 5, 7, 3).getTime())).toBe("05/01/2026 07:03");
	});
});

describe("formatTime", () => {
	it("shows hours and minutes on a 24-hour clock", () => {
		expect(formatTime(new Date(2026, 9, 20, 7, 5).getTime())).toBe("07:05");
	});
});

describe("timeAgo", () => {
	const now = new Date(2026, 9, 20, 19, 0).getTime();
	const minutes = (n: number) => now - n * 60_000;

	it("says now under a minute, then minutes, hours, and days", () => {
		expect(timeAgo(now, now - 30_000)).toEqual({ unit: "now", n: 0 });
		expect(timeAgo(now, minutes(1))).toEqual({ unit: "minutes", n: 1 });
		expect(timeAgo(now, minutes(59))).toEqual({ unit: "minutes", n: 59 });
		expect(timeAgo(now, minutes(60))).toEqual({ unit: "hours", n: 1 });
		expect(timeAgo(now, minutes(60 * 23 + 59))).toEqual({ unit: "hours", n: 23 });
		expect(timeAgo(now, minutes(60 * 24 * 3))).toEqual({ unit: "days", n: 3 });
	});

	it("treats a time ahead of the phone's clock as now", () => {
		expect(timeAgo(now, now + 120_000)).toEqual({ unit: "now", n: 0 });
	});
});
