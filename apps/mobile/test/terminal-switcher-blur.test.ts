import { expect, it, vi } from "vitest";
import { terminalHtml } from "../assets/terminal/page";
import { encodeTerminalMessage } from "../src/core/terminal-controls";

it("blurs xterm and the page's focused element without refocusing on output or fit", () => {
 const term = { blur: vi.fn(), focus: vi.fn(), write: vi.fn() };
 const element = { blur: vi.fn() };
 const refit = vi.fn();
 // Exercise the shipped page message handler, not a second implementation.
 const handler = terminalHtml.slice(terminalHtml.indexOf("function receive(event)"), terminalHtml.indexOf(" document.addEventListener('message',receive)"));
 const receive = new Function("term", "document", "refit", `${handler}; return receive;`)(term, { activeElement: element }, refit);
 receive({ data: encodeTerminalMessage({ type: "blur" }) });
 expect(term.blur).toHaveBeenCalledOnce();
 expect(element.blur).toHaveBeenCalledOnce();
 receive({ data: encodeTerminalMessage({ type: "output", bytes: new Uint8Array([65]) }) });
 receive({ data: encodeTerminalMessage({ type: "fit" }) });
 expect(term.write).toHaveBeenCalledOnce();
 expect(refit).toHaveBeenCalledOnce();
 expect(term.focus).not.toHaveBeenCalled();
 receive({ data: encodeTerminalMessage({ type: "focus" }) });
 expect(term.focus).toHaveBeenCalledOnce();
});
