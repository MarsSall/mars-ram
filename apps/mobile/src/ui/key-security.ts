import type { KeySecurityStatus } from "../core/key-security";
import type { Strings } from "./i18n/en";

export type SecurityTextKey = keyof Strings["keySecurity"];
export type SecurityViewState = { generation: number; changing: boolean; status: KeySecurityStatus | null };

export function beginSecurityChange(state: SecurityViewState): SecurityViewState {
 return {
  generation: state.generation + 1,
  changing: true,
  status: state.status && { ...state.status, perComputer: state.status.perComputer.map(computer => ({
   ...computer, phase: "added", lastError: undefined,
  })) },
 };
}
export function finishSecurityChange(state: SecurityViewState): SecurityViewState {
 // Keep the in-progress rows until a post-operation read supplies proof.
 return { ...state, changing: false };
}
export function acceptSecurityStatus(state: SecurityViewState, generation: number, status: KeySecurityStatus): SecurityViewState {
 if (state.changing || generation !== state.generation) return state;
 return { ...state, status };
}

export function securityErrorKey(error: unknown): SecurityTextKey {
 const code = error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
 switch (code) {
  case "ROTATION_PENDING": return "rotationPending";
  case "CREDENTIAL_METADATA_DAMAGED": return "metadataDamaged";
  case "KEY_ROTATION_NOT_INSTALLED": return "updateHost";
  // The core deliberately collapses remote command/guard failures to this safe code.
  case "KEY_ROTATION_FAILED":
  case "HOST_KEY_CHANGED":
  case "AUTH_FAILED": return "authorizationFailed";
  case "UNLOCK_REQUIRED": return "unlockRequired";
  case "KEY_INVALIDATED": return "keyInvalidated";
  default: return "failed";
 }
}

type Computer = Pick<KeySecurityStatus["perComputer"][number], "phase"> & { lastError?: { code: string } };
export function securityRow(computer: Computer): { textKey: SecurityTextKey; retry: boolean } {
 if (computer.lastError) {
  const offline = ["UNREACHABLE", "TIMEOUT", "HOST_NOT_FOUND"].includes(computer.lastError.code);
  return { textKey: offline ? "pending" : securityErrorKey(computer.lastError), retry: true };
 }
 return { textKey: computer.phase === "done" ? "done" : computer.phase === "pending" ? "pending" : "changing", retry: false };
}
