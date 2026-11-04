import { createDoctorAdapter } from "./adapters/doctor.ts";
import { spanish } from "./adapters/terminal.ts";
import { diagnose, type DoctorPorts } from "./core/doctor.ts";

const label: Record<string, string> = spanish ? { ok: "ok", warning: "aviso", problem: "problema" } : { ok: "ok", warning: "warning", problem: "problem" };

export async function doctorCommand(ports: DoctorPorts = createDoctorAdapter(), print: (line: string) => void = console.log): Promise<number> {
	const report = await diagnose(ports);
	for (const result of report.results) {
		// Registry names and configured home paths are untrusted; keep exactly one line per finding.
		print(`${label[result.status] ?? result.status}: ${result.finding}${result.fix ? ` ${result.fix}` : ""}`.replace(/[\r\n\x00-\x1f\x7f-\x9f]/g, " "));
	}
	return report.code;
}
