// Starts the tour once after the first pairing (QR or manual add), after the screen it opens.
import { pairingTour, startTour } from "../../services";

/** Long enough for the computer's screen to finish opening before the tour moves to Inicio. */
export const TOUR_SETTLE_MS = 600;

/** Runs the pairing; on success navigates, then starts the tour if this was the first computer. */
export async function pairThenTour<R extends { ok: boolean }>(run: () => Promise<R>, navigate: (result: Extract<R, { ok: true }>) => void): Promise<R> {
 const { result, startTour: start } = await pairingTour(run);
 if (!result.ok) return result;
 navigate(result as Extract<R, { ok: true }>);
 if (start) setTimeout(() => { void startTour(); }, TOUR_SETTLE_MS);
 return result;
}
