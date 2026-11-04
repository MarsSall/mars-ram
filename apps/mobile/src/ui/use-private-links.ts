import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { addAttachment, type Attachment } from "../core/attachment-draft";
import type { SavedHost } from "../core/host-catalog";
import type { LinkHistoryItem } from "../core/links";
import type { AttachmentSource } from "../core/media-source";
import { catalog, chooseAttachments, clipboard, createLinkService, sessions } from "../services";
import { linkOperationError, linkRow, newestLinks, selectComputer, unavailableLinks, type FilesError } from "./private-links";
export type { FilesError } from "./private-links";

let lastComputer: string | null = null;

/** Owns asynchronous UI state; the screen only renders actions and confirmed rows. */
export function usePrivateLinks() {
 const [hosts, setHosts] = useState<SavedHost[] | null>(null);
 const [selected, setSelected] = useState<string | null>(lastComputer);
 const [groups, setGroups] = useState<{ host: SavedHost; items: LinkHistoryItem[] }[]>([]);
 const [refreshing, setRefreshing] = useState(false);
 const [busy, setBusy] = useState<"uploading" | "removing" | null>(null);
 const [error, setError] = useState<FilesError | null>(null);
 const [candidates, setCandidates] = useState<Attachment[]>([]);
 const [copied, setCopied] = useState<string | null>(null);
 const [now, setNow] = useState(Date.now());
 const generation = useRef(0);
 const locked = useRef(false);
 const alive = useRef(true);
 useEffect(() => { alive.current = true; return () => { alive.current = false; generation.current++; }; }, []);
 const reload = useCallback(async (quiet = false) => {
  if (locked.current) return;
  const version = ++generation.current;
  // Old evidence is not current availability while a new check is in flight; a periodic
  // check keeps the rows (at most 30 s old) so they do not flash between checks.
  if (!quiet) {
   setRefreshing(true);
   setGroups(groups => groups.map(group => ({ ...group, items: unavailableLinks(group.items) })));
  }
  try {
   const computers = await catalog.list();
   if (generation.current !== version || !alive.current) return;
   setHosts(computers);
   setSelected(current => {
    const id = selectComputer(computers.map(host => host.id), current ?? lastComputer);
    lastComputer = id;
    return id;
   });
   const next = await Promise.all(computers.map(async host => ({ host, items: newestLinks(await createLinkService(host).history()) })));
   if (generation.current === version && alive.current) { setGroups(next); setNow(Date.now()); }
  } catch {
   if (generation.current === version && alive.current) setError({ key: "loadFailed" });
  } finally {
   if (generation.current === version && alive.current) setRefreshing(false);
  }
 }, []);
 useFocusEffect(useCallback(() => {
  void reload();
  const timer = setInterval(() => setNow(Date.now()), 1000);
  // A computer that goes away stops showing its links as available within 30 s.
  const poll = setInterval(() => { void reload(true); }, 30000);
  // Returning from the background does not change focus: check availability again.
  const activity = AppState.addEventListener("change", state => { if (state === "active") void reload(); });
  return () => { generation.current++; clearInterval(timer); clearInterval(poll); activity.remove(); };
 }, [reload]));
 const invalidateHost = (id: string) => setGroups(current => current.map(group => group.host.id === id ? { ...group, items: unavailableLinks(group.items) } : group));
 const chooseComputer = (id: string) => { if (!locked.current) { lastComputer = id; setSelected(id); setCandidates([]); } };
 const upload = async (file: Attachment) => {
  const host = hosts?.find(host => host.id === selected);
  if (!host || locked.current) return;
  // An explicit attempt may ask again after a cancelled or expired key unlock.
  sessions.allowUnlockAgain();
  locked.current = true;
  setCandidates([]); setBusy("uploading"); setError(null); setCopied(null);
  generation.current++; // A refresh started before this mutation cannot overwrite its result.
  try {
   const result = await createLinkService(host).create(file);
   if (!alive.current) return;
   if (!result.ok) { invalidateHost(host.id); setError(linkOperationError(result, "failed")); }
   else {
    setGroups(current => {
     const group = current.find(group => group.host.id === host.id);
     const items = newestLinks([{ ...result.value, status: "valid" }, ...(group?.items ?? []).filter(item => item.id !== result.value.id)]);
     return group ? current.map(group => group.host.id === host.id ? { host, items } : group) : [...current, { host, items }];
    });
    setNow(Date.now());
   }
  } catch { if (alive.current) { invalidateHost(host.id); setError({ key: "failed" }); } }
  finally { locked.current = false; if (alive.current) { setBusy(null); setRefreshing(false); } }
 };
 const select = async (source: AttachmentSource) => {
  if (locked.current) return;
  locked.current = true; setError(null); setCopied(null);
  try {
   const result = await chooseAttachments(source);
   if (!alive.current) return;
   if (!result.ok) { setError({ key: result.reason }); return; }
   const items = result.items.map(item => ({ ...item, kind: item.mimeType.startsWith("image/") ? "image" as const : "file" as const }));
   // A picker can return several files; never silently upload only the first.
   if (items.length > 1) setCandidates(items);
   else if (items[0]) {
    const checked = addAttachment([], items[0]);
    if (!checked.ok) setError({ key: "tooLarge" });
    else { locked.current = false; await upload(checked.items[0]!); }
   }
  } catch { if (alive.current) setError({ key: "sourceFailed" }); }
  finally { locked.current = false; }
 };
 const remove = async (host: SavedHost, item: LinkHistoryItem) => {
  if (locked.current || !linkRow(item, Date.now()).canRemove) return;
  sessions.allowUnlockAgain();
  locked.current = true; setBusy("removing"); setError(null); setCopied(null); generation.current++;
  try {
   const result = await createLinkService(host).remove(item.id, item.status);
   if (!alive.current) return;
   if (!result.ok) { invalidateHost(host.id); setError(linkOperationError(result, "removeFailed")); }
   else setGroups(current => current.map(group => group.host.id === host.id ? { ...group, items: group.items.filter(row => row.id !== item.id) } : group));
  } catch { if (alive.current) { invalidateHost(host.id); setError({ key: "removeFailed" }); } }
  finally { locked.current = false; if (alive.current) { setBusy(null); setRefreshing(false); } }
 };
 const copy = async (item: LinkHistoryItem) => {
  const row = linkRow(item, Date.now());
  if (!row.url) return;
  try { await clipboard.writeText(row.url); if (alive.current) setCopied(`${item.computerId}/${item.id}`); }
  catch { if (alive.current) setError({ key: "copyFailed" }); }
 };
 return { hosts, selected, groups, refreshing, busy, error, candidates, copied, now, chooseComputer, upload, select, remove, copy,
  // A reload by hand may ask to unlock again after a cancel, like the Sessions tab.
  cancelSelection: () => setCandidates([]), reload: () => { if (!locked.current) { sessions.allowUnlockAgain(); setError(null); void reload(); } },
 };
}
