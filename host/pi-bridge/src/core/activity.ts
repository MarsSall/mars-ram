// Pure fallback for hosts without Gentle's phase registry. Never infer from prose.
export function inferActivity(previous: string | null, toolName: string, args: unknown): string | null {
	if (["read", "grep", "find", "ls"].includes(toolName)) return "exploring";
	if (["edit", "write"].includes(toolName)) return "implementing";
	if (toolName === "bash" && args && typeof args === "object" && "command" in args && typeof args.command === "string") {
		// Match check runners, not arbitrary mentions of "test" in a path or echo.
		const check = /(?:^|&&|\|\||[;\n])\s*(?:(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|typecheck|build)(?=\s|$|[;&|])|(?:npx\s+)?(?:vitest|jest|pytest|tsc)(?=\s|$|[;&|])|cargo\s+(?:test|check|build)(?=\s|$|[;&|]))/;
		if (check.test(args.command)) return "checking";
	}
	return previous;
}
