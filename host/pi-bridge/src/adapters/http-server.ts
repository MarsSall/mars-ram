// Serves the protocol on the loopback address, behind the instance token. Moved to the protocol package's
// host-only entry point, shared with the CLI's agent bridges; the Pi bridge passes no hook channel.
export { type HttpBridgeServer, type HttpServerOptions, startHttpServer } from "@workspace/protocol/bridge-host";
