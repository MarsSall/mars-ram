import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { expect, it } from "vitest";

function sourceFiles(directory: string): string[] {
	return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
		const path = `${directory}/${entry.name}`;
		return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
	});
}

function importsGlobalRouter(source: string): boolean {
	const file = ts.createSourceFile("source.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
	return file.statements.some((statement) => {
		if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
			|| statement.moduleSpecifier.text !== "expo-router") return false;
		const bindings = statement.importClause?.namedBindings;
		return bindings !== undefined && ts.isNamedImports(bindings)
			&& bindings.elements.some((binding) => (binding.propertyName ?? binding.name).text === "router");
	});
}

it("recognizes singleton imports, including aliases and mixed imports", () => {
	for (const source of [
		'import { router } from "expo-router";',
		'import { useFocusEffect, router } from "expo-router";',
		'import { router as navigation, useRouter } from "expo-router";',
	]) expect(importsGlobalRouter(source)).toBe(true);
	for (const source of [
		'import { useRouter } from "expo-router";',
		'import { useRouter as router } from "expo-router";',
		'import { router } from "another-package";',
		'// import { router } from "expo-router";',
	]) expect(importsGlobalRouter(source)).toBe(false);
});

it("uses context-bound useRouter rather than the pre-render global singleton", () => {
	const root = fileURLToPath(new URL("../src", import.meta.url));
	const offenders = sourceFiles(root)
		.filter((path) => importsGlobalRouter(readFileSync(path, "utf8")))
		.map((path) => path.slice(root.length + 1));
	expect(offenders).toEqual([]);
});
