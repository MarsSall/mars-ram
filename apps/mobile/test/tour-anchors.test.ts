import { expect, it, vi } from "vitest";
import { TourAnchorRegistry, type Rect } from "../src/ui/tour/anchor-registry";

const measurer = (rect: Rect) => { const m = { rect, calls: 0, fn: (done: (r: Rect) => void) => { m.calls++; done(m.rect); } }; return m; };

it("measures a control when it registers and again on demand (layout, scroll, rotation)", () => {
 const registry = new TourAnchorRegistry();
 const listener = vi.fn();
 registry.subscribe(listener);
 const add = measurer({ x: 296, y: 44, width: 52, height: 52 });
 registry.register("computers.add", add.fn);
 expect(registry.rect("computers.add")).toEqual({ x: 296, y: 44, width: 52, height: 52 });
 add.rect = { x: 600, y: 20, width: 52, height: 52 };
 registry.measure();
 expect(registry.rect("computers.add")).toEqual({ x: 600, y: 20, width: 52, height: 52 });
 registry.measure("computers.add");
 expect(add.calls).toBe(3);
 // Same rect again: no extra change.
 expect(listener).toHaveBeenCalledTimes(2);
});

it("treats an unmeasured or zero-size control as absent and forgets it when it unmounts", () => {
 const registry = new TourAnchorRegistry();
 const off = registry.register("tabs.bar", measurer({ x: 0, y: 0, width: 0, height: 0 }).fn);
 expect(registry.rect("tabs.bar")).toBeNull();
 expect(registry.rect("home.sessions")).toBeNull();
 off();
 const later = registry.register("tabs.bar", measurer({ x: 0, y: 700, width: 360, height: 64 }).fn);
 expect(registry.rect("tabs.bar")).toEqual({ x: 0, y: 700, width: 360, height: 64 });
 later();
 expect(registry.rect("tabs.bar")).toBeNull();
});

it("keeps the newest registration when an older one with the same id unmounts", () => {
 const registry = new TourAnchorRegistry();
 const old = registry.register("terminal.project", measurer({ x: 1, y: 1, width: 40, height: 40 }).fn);
 registry.register("terminal.project", measurer({ x: 309, y: 0, width: 44, height: 42 }).fn);
 old();
 expect(registry.rect("terminal.project")).toEqual({ x: 309, y: 0, width: 44, height: 42 });
});

it("reports taps on a registered control to the tour", () => {
 const registry = new TourAnchorRegistry();
 const onTap = vi.fn();
 const off = registry.onTap(onTap);
 registry.tapped("tabs.bar");
 off();
 registry.tapped("tabs.bar");
 expect(onTap).toHaveBeenCalledExactlyOnceWith("tabs.bar");
});
