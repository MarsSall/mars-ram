export type ChatState = "closed" | "floating" | "full";

/** Distances in dp and vertical velocity in dp/ms (PanResponder units).
 * A tap is explicit: a cancelled or motionless drag must not open the chat.
 */
export function chatGesture({ state, dy, velocity, tap = false }: {
 state: Exclude<ChatState, "full">; dy: number; velocity: number; tap?: boolean;
}): ChatState {
 if (tap) return state === "closed" ? "floating" : "full";
 if (state === "floating" && dy >= 48) return "closed";
 if (dy <= -144 || (dy <= -16 && velocity <= -0.8)) return "full";
 if (dy <= -48) return state === "closed" ? "floating" : "full";
 return state;
}
