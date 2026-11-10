// Development probe for the SSH module, reachable from Settings › Developer.
// It drives every native function on a real phone; it is not a product screen.
import { StatusBar } from "expo-status-bar";
import { useState } from "react";
import { Button, SafeAreaView, ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { decodeResponse, StateResponse } from "@workspace/protocol";
import Ssh from "../../../modules/ssh/src/SshModule";
import type { Failure } from "../../core/ports";
import { sshModuleHostConnection } from "../../adapters/ssh-module-host-connection";
import { discoverBridges, openBridge } from "../../core/bridge-discovery";

const KEY_ALIAS = "app-ssh-key";

export default function SshProbe() {
	const [host, setHost] = useState("100.64.0.10");
	const [fallbackHost, setFallbackHost] = useState("");
	const [username, setUsername] = useState("mars");
	const [command, setCommand] = useState("echo SSH-OK; hostname");
	const [requireUnlock, setRequireUnlock] = useState(true);
	const [publicKey, setPublicKey] = useState("");
	const [trusted, setTrusted] = useState<string | null>(null);
	const [pending, setPending] = useState<Failure | null>(null);
	const [connectionId, setConnectionId] = useState<string | null>(null);
	const [log, setLog] = useState<string[]>([]);

	const note = (line: string) => {
		console.log(`PROBE ${line}`);
		setLog((lines) => [`${new Date().toLocaleTimeString()} ${line}`, ...lines].slice(0, 30));
	};
	const attempt = async (label: string, action: () => Promise<void>) => {
		const started = Date.now();
		try {
			await action();
		} catch (error) {
			note(`${label} failed: ${(error as Error).message}`);
		}
		// Duration lets the probe check timeouts.
		note(`${label} took ${((Date.now() - started) / 1000).toFixed(1)} s`);
	};
	const describe = (failure: Failure) => `${failure.code}: ${failure.message}${failure.detail ? ` [${failure.detail}]` : ""}`;

	const createKey = () =>
		attempt("Create key", async () => {
			const key = await Ssh.ensureKey(KEY_ALIAS, requireUnlock, "phone-dev-probe");
			setPublicKey(key.publicKey);
			// Exact text for authorizing the key on a host; never copy keys from screenshots.
			console.log(`PUBLIC_KEY ${key.publicKey}`);
			note(`Key ready ${key.fingerprint}`);
		});
	const deleteKey = () =>
		attempt("Delete key", async () => {
			await Ssh.deleteKey(KEY_ALIAS);
			setPublicKey("");
			note("Key deleted");
		});
	const unlock = () => attempt("Unlock", async () => note(`Unlock: ${(await Ssh.unlock("Unlock the SSH key")) ? "ok" : "cancelled"}`));
	const connect = () =>
		attempt("Connect", async () => {
			const result = await Ssh.connect({
				host,
				fallbackHost: fallbackHost || null,
				port: 22,
				username,
				keyAlias: KEY_ALIAS,
				expectedFingerprint: trusted,
			});
			if (result.ok) {
				setConnectionId(result.connectionId);
				setPending(null);
				note(`Connected via ${result.address}`);
			} else {
				setPending(result.fingerprint ? result : null);
				note(describe(result));
			}
		});
	const exec = () =>
		attempt("Exec", async () => {
			if (!connectionId) return note("Not connected");
			const result = await Ssh.exec(connectionId, command);
			note(result.ok ? `Output: ${result.stdout.trim().replace(/\n/g, " | ")} (exit ${result.exitStatus})` : describe(result));
		});
	const disconnect = () =>
		attempt("Disconnect", async () => {
			if (connectionId) await Ssh.disconnect(connectionId);
			setConnectionId(null);
			note("Disconnected");
		});
	const check = () => note(`Connected: ${connectionId ? Ssh.isConnected(connectionId) : false}`);
	// Opens the bridge's never-ending event stream through a tunnel, closes the tunnel, and checks the stream is cut.
	const cutTest = () =>
		attempt("Cut test", async () => {
			if (!connectionId) return note("Not connected");
			const found = await discoverBridges(sshModuleHostConnection, connectionId);
			if (!found.ok || !found.bridges[0]) return note("No bridge");
			const opened = await openBridge(sshModuleHostConnection, connectionId, found.bridges[0]);
			if (!opened.ok) return note(describe(opened));
			const stream = fetch(`${opened.baseUrl}/events?since=0`, { headers: { authorization: `Bearer ${opened.token}` } })
				.then((res) => res.text())
				.then(() => "ended", () => "cut");
			await new Promise((resolve) => setTimeout(resolve, 2000));
			await opened.close();
			const outcome = await Promise.race([stream, new Promise((resolve) => setTimeout(() => resolve("still open after 10 s"), 10000))]);
			note(`Stream after closing the tunnel: ${outcome}`);
		});

	// Finds the session bridges over SFTP with the real use case, tunnels to the newest, and asks for its state.
	const bridge = () =>
		attempt("Bridge", async () => {
			if (!connectionId) return note("Not connected");
			const found = await discoverBridges(sshModuleHostConnection, connectionId);
			if (!found.ok) return note(describe(found));
			found.skipped.forEach((s) => note(`Skipped ${s.path}: ${s.reason}`));
			const newest = found.bridges[0];
			if (!newest) return note("No bridge running on this host");
			const opened = await openBridge(sshModuleHostConnection, connectionId, newest);
			if (!opened.ok) return note(describe(opened));
			try {
				const res = await fetch(`${opened.baseUrl}/state`, { headers: { authorization: `Bearer ${opened.token}` } });
				const state = decodeResponse(StateResponse, await res.json());
				note(
					state.ok
						? `Bridge ${res.status}: ${found.bridges.length} found, protocol ${state.value.protocolVersion}, session ${state.value.sessionId}, idle ${state.value.idle}`
						: `Bridge answered an invalid state: ${state.errors.join("; ")}`,
				);
			} finally {
				await opened.close();
			}
		});

	return (
		<SafeAreaView style={styles.screen}>
			<ScrollView contentContainerStyle={styles.content}>
				<Text style={styles.title}>SSH module probe</Text>
				<TextInput style={styles.input} value={host} onChangeText={setHost} placeholder="Host" autoCapitalize="none" />
				<TextInput style={styles.input} value={fallbackHost} onChangeText={setFallbackHost} placeholder="Fallback host" autoCapitalize="none" />
				<TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="User" autoCapitalize="none" />
				<TextInput style={styles.input} value={command} onChangeText={setCommand} placeholder="Command" autoCapitalize="none" />
				<View style={styles.row}>
					<Text>Require unlock for new key</Text>
					<Switch value={requireUnlock} onValueChange={setRequireUnlock} />
				</View>
				<View style={styles.buttons}>
					<Button title="Create key" onPress={createKey} />
					<Button title="Delete key" onPress={deleteKey} />
					<Button title="Unlock" onPress={unlock} />
					<Button title="Connect" onPress={connect} />
					<Button title="Exec" onPress={exec} />
					<Button title="Check" onPress={check} />
					<Button title="Bridge" onPress={bridge} />
					<Button title="Cut test" onPress={cutTest} />
					<Button title="Disconnect" onPress={disconnect} />
				</View>
				{publicKey ? <Text selectable style={styles.mono}>{publicKey}</Text> : null}
				{pending ? (
					<View style={styles.box}>
						<Text>Host identity: {pending.fingerprint}</Text>
						{pending.code === "HOST_KEY_CHANGED" ? <Text style={styles.warn}>Changed! Expected {pending.expected}</Text> : null}
						<Button title="Trust this identity" onPress={() => setTrusted(pending.fingerprint ?? null)} />
					</View>
				) : null}
				<Text>Trusted: {trusted ?? "none"}</Text>
				<Text>Connection: {connectionId ?? "none"}</Text>
				{log.map((line, i) => (
					<Text key={i} selectable style={styles.mono}>
						{line}
					</Text>
				))}
			</ScrollView>
			<StatusBar style="auto" />
		</SafeAreaView>
	);
}

const styles = StyleSheet.create({
	screen: { flex: 1, backgroundColor: "#fff" },
	content: { padding: 16, paddingTop: 48, gap: 10 },
	title: { fontSize: 20, fontWeight: "600" },
	input: { borderWidth: 1, borderColor: "#999", borderRadius: 6, padding: 8 },
	row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
	buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
	box: { borderWidth: 1, borderColor: "#c90", padding: 8, gap: 6 },
	warn: { color: "#c00", fontWeight: "600" },
	mono: { fontFamily: "monospace", fontSize: 12 },
});
