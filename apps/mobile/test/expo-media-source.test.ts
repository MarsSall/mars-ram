import { beforeEach, describe, expect, it, vi } from "vitest";

const f = vi.hoisted(() => ({
 gallery: vi.fn(), camera: vi.fn(), permission: vi.fn(), documents: vi.fn(), hasImage: vi.fn(), image: vi.fn(), write: vi.fn(), create: vi.fn(),
}));
vi.mock("expo-image-picker", () => ({ launchImageLibraryAsync: f.gallery, launchCameraAsync: f.camera, requestCameraPermissionsAsync: f.permission }));
vi.mock("expo-document-picker", () => ({ getDocumentAsync: f.documents }));
vi.mock("expo-clipboard", () => ({ hasImageAsync: f.hasImage, getImageAsync: f.image }));
vi.mock("expo-file-system", () => ({ Paths: { cache: "file:///cache/" }, File: class {
 uri = "file:///cache/clipboard-id.png"; size = 123;
 create = f.create; write = f.write;
} }));
vi.mock("../src/adapters/platform", () => ({ newId: () => "id" }));
import { expoMediaSource } from "../src/adapters/expo-media-source";

beforeEach(() => { vi.resetAllMocks(); });
describe("SDK 58 attachment source adapter", () => {
 it("uses the system photo picker with multiple selection and keeps metadata", async () => {
  f.gallery.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///photo.png", fileName: "photo.png", fileSize: 42, mimeType: "image/png" }, { uri: "file:///other.jpg" }] });
  const result = await expoMediaSource.select("gallery");
  expect(f.gallery).toHaveBeenCalledWith({ mediaTypes: ["images"], allowsMultipleSelection: true });
  expect(result).toEqual({ ok: true, items: [
   { id: "id", sourceUri: "file:///photo.png", displayName: "photo.png", size: 42, mimeType: "image/png" },
   { id: "id", sourceUri: "file:///other.jpg", displayName: "other.jpg", size: null, mimeType: "image/jpeg" },
  ] });
  expect(f.permission).not.toHaveBeenCalled();
 });
 it("keeps content URIs without making a cache copy", async () => {
  f.documents.mockResolvedValue({ canceled: false, assets: [{ uri: "content://provider/42", name: "report.pdf" }] });
  expect(await expoMediaSource.select("files")).toEqual({ ok: true, items: [{ id: "id", sourceUri: "content://provider/42", displayName: "report.pdf", size: null, mimeType: "application/octet-stream" }] });
  expect(f.documents).toHaveBeenCalledWith({ type: "*/*", multiple: true, copyToCacheDirectory: false });
 });
 it("only opens the camera after permission is granted", async () => {
  f.permission.mockResolvedValueOnce({ granted: false });
  expect(await expoMediaSource.select("camera")).toEqual({ ok: false, reason: "cameraDenied" });
  expect(f.camera).not.toHaveBeenCalled();
  f.permission.mockResolvedValueOnce({ granted: true });
  f.camera.mockResolvedValue({ canceled: false, assets: [{ uri: "file:///camera.jpg", fileName: "camera.jpg", mimeType: "image/jpeg", fileSize: 1 }] });
  expect(await expoMediaSource.select("camera")).toMatchObject({ ok: true, items: [{ displayName: "camera.jpg", size: 1 }] });
 });
 it.each(["gallery", "files", "camera"] as const)("cancellation of %s changes nothing", async source => {
  f.permission.mockResolvedValue({ granted: true });
  f.gallery.mockResolvedValue({ canceled: true }); f.documents.mockResolvedValue({ canceled: true }); f.camera.mockResolvedValue({ canceled: true });
  expect(await expoMediaSource.select(source)).toEqual({ ok: true, items: [] });
 });
 it("does not write when the clipboard has no image (including a clipboard change)", async () => {
  f.hasImage.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  f.image.mockResolvedValue(null);
  expect(await expoMediaSource.select("clipboard")).toEqual({ ok: false, reason: "noImage" });
  expect(f.image).not.toHaveBeenCalled();
  expect(await expoMediaSource.select("clipboard")).toEqual({ ok: false, reason: "noImage" });
  expect(f.create).not.toHaveBeenCalled();
 });
 it("writes clipboard PNG bytes, not a data URL, to a file cache URI", async () => {
  f.hasImage.mockResolvedValue(true); f.image.mockResolvedValue({ data: "data:image/png;base64,AABB", size: { width: 1, height: 1 } });
  expect(await expoMediaSource.select("clipboard")).toEqual({ ok: true, items: [{ id: "id", sourceUri: "file:///cache/clipboard-id.png", displayName: "clipboard-id.png", size: 123, mimeType: "image/png" }] });
  expect(f.image).toHaveBeenCalledWith({ format: "png" });
  expect(f.write).toHaveBeenCalledWith("AABB", { encoding: "base64" });
 });
 it("turns platform failures into a localizable reason", async () => {
  f.documents.mockRejectedValue(new Error("provider crashed"));
  expect(await expoMediaSource.select("files")).toEqual({ ok: false, reason: "sourceFailed" });
 });
});
