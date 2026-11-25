// Publishes how to reach a running bridge. Moved to the protocol package's host-only entry point,
// shared with the CLI's agent bridges.
export { publishEntry, pruneStaleEntries, removeEntry } from "@workspace/protocol/bridge-host";
