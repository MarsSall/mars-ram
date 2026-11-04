import { describe, expect, it } from "vitest";
import { PROTOCOL_VERSION } from "@workspace/protocol";
import { bridgeClient, type BridgeHttp } from "../src/core/bridge-client";

const endpoint = { baseUrl: "http://loopback", token: "token" };
describe("bridge focus client contract", () => {
 it("posts no target and decodes the focus envelope", async () => {
  const calls: unknown[][] = [];
  const value = { protocolVersion: PROTOCOL_VERSION, bridgeInstanceId: "bridge", sessionId: "session", status: "focused" };
  const http: BridgeHttp = { request: async (...args) => { calls.push(args); return { ok: true, status: 200, data: value }; } };
  expect(await bridgeClient.terminalFocus(http, endpoint)).toEqual({ ok: true, value });
  expect(calls).toEqual([["POST", "http://loopback/terminal/focus", "token", undefined]]);
 });
 it("returns old-bridge 404 as unavailable", async () => {
  const http: BridgeHttp = { request: async () => ({ ok: true, status: 404, data: {} }) };
  expect(await bridgeClient.terminalFocus(http, endpoint)).toMatchObject({ ok: false, reason: "refused" });
 });
 it("rejects a success without the envelope", async () => {
  const http: BridgeHttp = { request: async () => ({ ok: true, status: 200, data: { status: "focused" } }) };
  expect(await bridgeClient.terminalFocus(http, endpoint)).toMatchObject({ ok: false, reason: "invalid" });
 });
});
