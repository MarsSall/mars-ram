import * as Clipboard from "expo-clipboard";
import * as Documents from "expo-document-picker";
import { File, Paths } from "expo-file-system";
import * as Images from "expo-image-picker";
import type { MediaSource } from "../core/media-source";
import { newId } from "./platform";

export const expoMediaSource: MediaSource = {
 async select(source) {
  try {
   if (source === "clipboard") {
    if (!await Clipboard.hasImageAsync()) return { ok: false, reason: "noImage" };
    const image = await Clipboard.getImageAsync({ format: "png" });
    if (!image) return { ok: false, reason: "noImage" };
    const id = newId();
    const name = `clipboard-${id}.png`;
    const file = new File(Paths.cache, name);
    file.create();
    await file.write(image.data.replace(/^data:image\/png;base64,/, ""), { encoding: "base64" });
    return { ok: true, items: [{ id, sourceUri: file.uri, displayName: name, size: file.size, mimeType: "image/png" }] };
   }
   if (source === "files") {
    const result = await Documents.getDocumentAsync({ type: "*/*", multiple: true, copyToCacheDirectory: false });
    return { ok: true, items: result.canceled ? [] : result.assets.map(asset => ({ id: newId(), sourceUri: asset.uri, displayName: asset.name, size: asset.size ?? null, mimeType: asset.mimeType ?? "application/octet-stream" })) };
   }
   if (source === "camera" && !(await Images.requestCameraPermissionsAsync()).granted) return { ok: false, reason: "cameraDenied" };
   // The Android system photo picker requires no broad media/storage permission.
   const result = source === "gallery"
    ? await Images.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: true })
    : await Images.launchCameraAsync({ mediaTypes: ["images"] });
   return { ok: true, items: result.canceled ? [] : result.assets.map(asset => ({ id: newId(), sourceUri: asset.uri, displayName: asset.fileName ?? asset.uri.split("/").pop() ?? "image.jpg", size: asset.fileSize ?? null, mimeType: asset.mimeType ?? "image/jpeg" })) };
  } catch { return { ok: false, reason: "sourceFailed" }; }
 },
};
