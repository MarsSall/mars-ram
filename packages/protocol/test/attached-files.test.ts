import { describe, expect, it } from "vitest";
import { withAttachedFiles, splitAttachedFiles } from "../src/index.ts";

describe("attached-file text format", () => {
	it("recognizes camera-only history with CRLF without changing the user's text", () => {
		const name = "20261023-145846-ll1uf5-805f9232-03b2-405f-8a85-0d4b22a8821d.jpeg";
		for (const text of ["", "look\r\nhere"]) {
			const history = withAttachedFiles(text, [`C:\\Users\\alex\\.mars-ram\\uploads\\${name}`]).replace(/(?<!\r)\n/g, "\r\n");
			expect(splitAttachedFiles(history)).toEqual({ text, files: [name] });
		}
	});
	it("keeps the bridge's bytes and round trips text with images and documents", () => {
		const paths = ["/home/me/.mars-ram/uploads/photo.png", "/home/me/.mars-ram/uploads/notes.txt"];
		expect(withAttachedFiles("look", paths)).toBe(`look\n\nAttached files:\n${paths.join("\n")}`);
		expect(splitAttachedFiles(withAttachedFiles("look", paths))).toEqual({ text: "look", files: ["photo.png", "notes.txt"] });
	});
	it("handles attachment-only and text-only files, including Windows paths", () => {
		expect(withAttachedFiles("", ["/uploads/notes.txt"])).toBe("Attached files:\n/uploads/notes.txt");
		expect(splitAttachedFiles(withAttachedFiles("", ["C:\\Users\\alex\\.mars-ram\\uploads\\x.png"]))).toEqual({ text: "", files: ["x.png"] });
		expect(splitAttachedFiles(withAttachedFiles("read", ["/uploads/notes.txt"]))).toEqual({ text: "read", files: ["notes.txt"] });
	});
	it.each(["hello", "Attached files:", "hello\nAttached files:\n/uploads/x.png", "hello\n\nAttached files:\n/uploads/x.png\nmore text", "Attached files:\nrelative.png", "Attached files:\n/uploads/x.png\n", "Attached files:\n/uploads/x.png\n\ncontinued"])("does not strip an inexact or non-terminal block: %s", text => {
		expect(splitAttachedFiles(text)).toEqual({ text, files: [] });
	});
});

describe("Pi's note about a resized image", () => {
	const path = "/home/alex/.mars-ram/uploads/20261023-160117-jlnk5h-6b3a6b85-0245-4d0e-8407-ef9babd97de0.jpeg";
	const note = "[Image: original 2252x4000, displayed at 1126x2000. Multiply coordinates by 2.00 to map to original image.]";

	it("is removed with the block when the photo was sent alone, as seen on the phone", () => {
		expect(splitAttachedFiles(`Attached files:\n${path}${note}`)).toEqual({ text: "", files: [path.split("/").at(-1)] });
		expect(splitAttachedFiles(`Attached files:\n${path}\n\n${note}`)).toEqual({ text: "", files: [path.split("/").at(-1)] });
	});

	it("is removed after text and several files, one note per resized image", () => {
		const other = "/home/alex/.mars-ram/uploads/20261023-160200-abcdef-b.png";
		expect(splitAttachedFiles(`¿Qué ves?\n\nAttached files:\n${path}\n${other}${note}${note}`)).toEqual({
			text: "¿Qué ves?",
			files: [path.split("/").at(-1), "20261023-160200-abcdef-b.png"],
		});
	});

	it("leaves the text alone when something other than notes follows the paths", () => {
		const text = `Attached files:\n${path}${note}\nmore text`;
		expect(splitAttachedFiles(text)).toEqual({ text, files: [] });
	});
});
