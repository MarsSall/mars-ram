# Privacy policy

**Effective date: November 3, 2026**

Mars-RAM has no account or operator-run cloud. We do not include analytics, advertising or tracking. Your work stays on your phone and your computers, subject to the services you choose to use on them.

## Connections and third parties

The app connects to your computers over your Tailscale network, mainly through SSH. Pairing also sends a request directly to your computer over that network. Tailscale is a separate service; its own privacy practices apply. Session content and attachments reach your computer and the programs you use there, including any agent or model provider you choose. Those programs may handle data under their own policies.

If you download the on-device voice model, the app makes an HTTPS download request to **huggingface.co**; Hugging Face and any download hosts reached by redirects can see your IP address and ordinary request information. Opening the privacy policy, source code, or an external link uses your browser and contacts the relevant website.

## Information on your phone

- Saved computers include their name, address, username, port and pinned host identity. The app's SSH private key stays in Android Keystore; device unlock is required by default.
- The app keeps settings such as theme and attachment retention, session shortcuts and the downloaded voice model. The language selection currently lasts for the app session. Drafts are held in memory; selected media may also be cached on the phone.
- The app accesses the microphone when you hold or lock it, and briefly after a short tap while waiting for a possible second tap. Audio is kept in memory, transcribed on the phone with Parakeet, and not written to disk or sent over the network. The resulting text is placed in the chat draft or terminal; you control sending it.
- The camera scans pairing QR codes and can also take a photo when you choose it as an attachment. QR frames are not saved or sent by the app; a photo you choose can be cached and uploaded.

## Files on your computer

Attachments are copied to `~/.mars-ram/uploads` on the selected computer. Cleanup is best effort when the app connects, according to your setting: 1, 7 or 30 days, or never. Private links use copies in `~/.mars-ram/links`; your computer serves them on your tailnet. Anyone on that tailnet with the link can open it until it expires or is deleted. Links expire after one day.

## Delete data

- Uninstall the Android app to remove its app data and Keystore key from the phone. Copies on your computers are not removed.
- Use **Forget this computer** to remove its saved identity from the app. The phone's public key remains authorized on that computer until you remove it there.
- Use **Remove the voice model** in settings to remove the downloaded model.
- On a computer, `mars-ram uninstall` removes the installed integration, but retains shared files, link data, phone authorization keys and session registry. Delete unwanted copies and keys on the computer separately.

## Contact

Questions about privacy: kiwi348@gmail.com.
