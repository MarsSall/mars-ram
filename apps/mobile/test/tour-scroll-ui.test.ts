import { afterEach, expect, it, vi } from "vitest";

const remeasure = vi.fn();
vi.mock("react", async (original) => ({
 ...(await original<typeof import("react")>()),
 useRef: (value: unknown) => ({ current: value }),
 useCallback: (fn: unknown) => fn,
 useEffect: () => {},
 useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}));
vi.mock("../src/ui/tour/anchors", () => ({ useTourRemeasure: () => remeasure }));
vi.mock("../src/services", async () => {
 const { AppTour } = await import("../src/core/tour");
 return { appTour: new AppTour({ store: { read: async () => ({ kind: "none" }), write: async () => {} } }) };
});

const { appTour } = await import("../src/services");
const { useTourScroll } = await import("../src/ui/tour/scroll");

const layout = (y: number) => ({ nativeEvent: { layout: { x: 0, y, width: 360, height: 88 } } }) as never;
function mounted() {
 const scroll = useTourScroll();
 const scrollTo = vi.fn();
 scroll.props.ref.current = { scrollTo } as never;
 return { scroll, scrollTo };
}
afterEach(async () => { await appTour.skip(); vi.useRealTimers(); });

it("brings the current step's card into view, with room above it for the bubble", async () => {
 vi.useFakeTimers();
 appTour.start({ hasSession: false });
 for (let i = 0; i < 6; i++) await appTour.advance();
 expect(appTour.current()?.anchor).toBe("settings.notifications");
 const { scroll, scrollTo } = mounted();
 scroll.place("settings.notifications")(layout(900));
 expect(scrollTo).toHaveBeenCalledWith({ y: 804, animated: false });
 vi.runAllTimers();
 expect(remeasure).toHaveBeenCalled();
});

it("leaves the scroll alone for other targets and when no tour runs", () => {
 const { scroll, scrollTo } = mounted();
 scroll.place("settings.about")(layout(1200));
 appTour.start({ hasSession: false });
 scroll.place("settings.about")(layout(1200));
 expect(scrollTo).not.toHaveBeenCalled();
 expect(scroll.props.onScroll).toBe(remeasure);
});
