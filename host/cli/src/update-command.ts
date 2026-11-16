// Composition for `mars-ram update`: the core decides, the adapter runs and prints.
import { spanish } from "./adapters/terminal.ts";
import { createUpdatePorts } from "./adapters/update.ts";
import { update, type UpdatePorts } from "./core/update.ts";

export function updateCommand(ports: UpdatePorts = createUpdatePorts()): Promise<number> {
	return update(ports, spanish);
}
