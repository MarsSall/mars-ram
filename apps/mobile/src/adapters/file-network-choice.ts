import { File, Paths } from "expo-file-system";
import type { NetworkChoiceStore } from "../core/network-choice";

const file = () => new File(Paths.document, "wizard-network.json");
let queue: Promise<unknown> = Promise.resolve();

/** Only the wizard's last network choice; read once, synchronously, when the app opens. */
export const fileNetworkChoice: NetworkChoiceStore = {
 read: () => { const current = file(); return current.exists ? current.textSync() : null; },
 write: text => {
  const write = async () => { const current = file(); if (!current.exists) current.create(); await current.write(text); };
  const next = queue.then(write, write);
  queue = next.catch(() => undefined);
  return next;
 },
};
