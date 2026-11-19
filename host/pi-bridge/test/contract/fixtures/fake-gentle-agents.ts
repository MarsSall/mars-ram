// Stands in for Gentle Agents in contract tests: answers the active-task
// request on Pi's event bus with the payload shape of gentle-pi's
// lib/herdr-desktop-events.ts (`{ sessionId, tasks: HerdrDesktopTask[] }`),
// plus a snapshot of another session the bridge must ignore.
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function fakeGentleAgents(pi: ExtensionAPI) {
	pi.events.on("gentle-pi:herdr-desktop:tasks-request", (value) => {
		const sessionId = (value as { sessionId?: unknown } | null)?.sessionId;
		if (typeof sessionId !== "string") return;
		pi.events.emit("gentle-pi:herdr-desktop:tasks", { sessionId: "another-session", tasks: [{ id: "foreign", agent: "x", label: "x", status: "running", pendingQuery: false }] });
		pi.events.emit("gentle-pi:herdr-desktop:tasks", {
			sessionId,
			tasks: [
				{ id: "task-1", agent: "sdd-apply", label: "Implement the bridge", status: "running", pendingQuery: false },
				{ id: "task-2", agent: "explore", label: "Read the spec", explicitLabel: "Read the spec", status: "waiting", pendingQuery: true },
				{ id: "task-3", agent: "review", label: "Queued review", status: "queued", pendingQuery: false },
				{ id: "task-4", agent: "done", label: "Finished", status: "completed", pendingQuery: false },
			],
		});
	});
}
