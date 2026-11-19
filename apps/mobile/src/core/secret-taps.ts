// Hidden gesture: tapping the app version several times in a row opens the gift code field.
export const SECRET_TAPS = 7;
/** Longest pause between two taps of the same run. */
export const SECRET_TAP_GAP_MS = 1500;
/** From this tap on, the remaining count is shown. */
export const SECRET_TAP_HINT_FROM = 4;

export type SecretTaps = { count: number; last: number };
export type SecretTapResult = {
 /** Pass it back with the next tap. */
 state: SecretTaps;
 /** True on the tap that completes the run; the count starts over. */
 open: boolean;
 /** Taps still needed, once the run is long enough to hint it. */
 remaining: number | null;
};

export function registerSecretTap(previous: SecretTaps | null, now: number): SecretTapResult {
 const continues = previous !== null && previous.count > 0 && now >= previous.last && now - previous.last <= SECRET_TAP_GAP_MS;
 const count = continues ? previous.count + 1 : 1;
 if (count >= SECRET_TAPS) return { state: { count: 0, last: now }, open: true, remaining: null };
 return { state: { count, last: now }, open: false, remaining: count >= SECRET_TAP_HINT_FROM ? SECRET_TAPS - count : null };
}
