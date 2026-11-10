# Privacy policy

**Effective date: November 8, 2026**

Mars-RAM has no account or operator-run cloud. We do not include analytics, advertising or tracking. Your work stays on your phone and your computers, subject to the services you choose to use on them.

## Connections and third parties

The app connects to your computers over your Tailscale network, mainly through SSH. Pairing also sends a request directly to your computer over that network. Tailscale is a separate service; its own privacy practices apply. Session content and attachments reach your computer and the programs you use there, including any agent or model provider you choose. Those programs may handle data under their own policies.

If you download the on-device voice model, the app makes an HTTPS download request to **huggingface.co**; Hugging Face and any download hosts reached by redirects can see your IP address and ordinary request information. Opening the privacy policy, source code, or an external link uses your browser and contacts the relevant website.

To check whether a newer computer-side release is available, the app makes an HTTPS GET request to **registry.npmjs.org/mars-ram/latest**, at most once a day when checking connected computers. npm can see your IP address and ordinary request data. The request sends no computer names, addresses, session content, attachments or credentials. The last attempt time and the latest validated public release are cached on your phone; offline or failed checks are silent and are not retried that day. This optional check only supplies an update notice and never installs anything.

When the app was installed from Google Play, it asks the Google Play app on your phone whether a newer version of Mars-RAM exists, at most once a day. Google Play performs this check under Google's own policies; the app sends us nothing and adds no information of its own. If you choose «Update», Google Play downloads and installs the new version. Builds installed outside Google Play skip the check silently.

## Optional session notices

Notices are off by default. Android 13+ asks for notification permission when you enable a mode. **While working** observes your saved computers over SSH and stops after two minutes with no working/waiting sessions or two hours without state changes. **Always attentive** listens on your phone's Tailscale address; each computer sends authenticated project-name-and-state notices directly inside your tailnet. These notices use no external relay, Firebase, analytics, or other third-party notification provider. Tailscale's own policies still apply. No agent text is included in notifications; Android's lock-screen settings control their visibility.

The phone stores your selected mode, and, for Always attentive, a per-computer random notice secret and replay-protection cursors. Secrets/cursors are encrypted under a non-exportable Android Keystore key in backup-excluded storage. Unlike the SSH key, this notice-only key does not require device unlock, so the listener can work while the SSH key is locked. The paired computer stores its copy of the secret, phone tailnet address and port, and host identity in private files under `~/.mars-ram/notify`. Secrets are exchanged only over authenticated SSH stdin, never command arguments. The existing link-server process remains running while registered phones exist.

Always attentive needs Tailscale on and exclusion from battery optimization; it cannot detect connection loss. Delivery under Doze/manufacturer restrictions is not guaranteed. There are no notices after force-stop or process death, and no automatic boot restart.

## Information on your phone

- Saved computers include their name, address, username, port and pinned host identity. The app's SSH private key stays in Android Keystore; device unlock is required by default.
- The app keeps settings such as theme and attachment retention, session shortcuts and the downloaded voice model. It also remembers the last version whose «What's new» notes you saw and the time and answer of the last Google Play update check. The language selection currently lasts for the app session. Drafts are held in memory; selected media may also be cached on the phone.
- The app accesses the microphone when you hold or lock it, and briefly after a short tap while waiting for a possible second tap. Audio is kept in memory, transcribed on the phone with Parakeet, and not written to disk or sent over the network. The resulting text is placed in the chat draft or terminal; you control sending it.
- The camera scans pairing QR codes and can also take a photo when you choose it as an attachment. QR frames are not saved or sent by the app; a photo you choose can be cached and uploaded.

## Files on your computer

Attachments are copied to a private folder of your user in the selected computer's temp directory (`/tmp/mars-ram-<uid>/uploads` on Linux, `%TEMP%\mars-ram\uploads` on Windows), not to your home folder. The computer refuses the folder if another user owns it or could open it. Cleanup is best effort when the app connects, according to your setting: 1, 7 or 30 days, or never; the system may also clear its temp directory, for example on restart. Updating the computer side with `mars-ram install` deletes the attachments that older versions kept in `~/.mars-ram/uploads`; `mars-ram uninstall` deletes both folders. Private links use copies in `~/.mars-ram/links`; your computer serves them on your tailnet. Anyone on that tailnet with the link can open it until it expires or is deleted. Links expire after one day.

## Delete data

- Uninstall the Android app to remove its app data and Keystore key from the phone. Copies on your computers are not removed.
- Use **Forget this computer** to remove its saved identity and local notification secret/replay cursors. Switching away from Always attentive also deletes local notification secrets and attempts `mars-ram notify unregister` over SSH. Remote removal is best effort: an offline computer can retain its record and keep trying, but a forgotten local secret rejects its notices. Remove a retained remote record from that phone's SSH connection with `mars-ram notify unregister`. The phone's public SSH key remains authorized on the computer until you remove it there.
- Use **Remove the voice model** in settings to remove the downloaded model.
- On a computer, `mars-ram uninstall` removes the installed integration, but retains shared files, link data, phone authorization keys and session registry. Delete unwanted copies and keys on the computer separately.

## Contact

Questions about privacy: kiwi348@gmail.com.
