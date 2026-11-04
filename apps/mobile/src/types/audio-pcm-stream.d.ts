// The package ships its typings under the name of the library it forked
// (react-native-live-audio-stream); expose them under the name we import.
declare module "@fugood/react-native-audio-pcm-stream" {
 export type Options = { sampleRate: number; channels: 1 | 2; bitsPerSample: 8 | 16; audioSource?: number; wavFile: string; bufferSize?: number };
 const AudioRecord: {
  /** Rejects when Android cannot initialize the recorder (e.g. without the permission). */
  init(options: Options): Promise<void>;
  start(): void;
  /** Fire and forget: the native method returns nothing. */
  stop(): void;
  on(event: "data", callback: (base64Pcm: string) => void): { remove(): void };
 };
 export default AudioRecord;
}
