import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { router } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { type ManualHostDetails, type ManualHostInput, validateManualHost } from "../../core/manual-host";
import { appKey, manual } from "../../services";
import { Card, PrimaryButton, Screen, SectionTitle } from "../../ui/components";
import { usePreferences } from "../../ui/preferences";

type Phase =
	| { kind: "form" }
	| { kind: "checking" }
	| { kind: "confirm"; details: ManualHostDetails; fingerprint: string }
	| { kind: "saving" }
	| { kind: "rejected" };

export default function ManualAddScreen() {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	const [publicKey, setPublicKey] = useState("");
	const [copied, setCopied] = useState(false);
	const [input, setInput] = useState<ManualHostInput>({ name: "", address: "", user: "", sshPort: "22" });
	const [errors, setErrors] = useState<Partial<Record<keyof ManualHostInput, string>>>({});
	const [phase, setPhase] = useState<Phase>({ kind: "form" });
	const [failure, setFailure] = useState("");

	useEffect(() => {
		void appKey.ensure().then((key) => setPublicKey(key.publicKey));
	}, []);

	const check = async () => {
		const valid = validateManualHost(input);
		if (!valid.ok) {
			setErrors(Object.fromEntries(Object.entries(valid.errors).map(([k, v]) => [k, v === "required" ? t.add.required : t.add.invalidPort])));
			return;
		}
		setErrors({});
		setFailure("");
		setPhase({ kind: "checking" });
		const identity = await manual.discoverIdentity(valid.value);
		if (!identity.ok) {
			setFailure(identity.message);
			setPhase({ kind: "form" });
			return;
		}
		setPhase({ kind: "confirm", details: valid.value, fingerprint: identity.fingerprint });
	};

	const confirm = async (details: ManualHostDetails, fingerprint: string) => {
		setPhase({ kind: "saving" });
		const result = await manual.confirm(details, fingerprint, t.add.unlockTitle);
		if (result.ok) {
			router.dismissTo({ pathname: "/computer/[id]", params: { id: result.host.id } });
			return;
		}
		setFailure(result.message);
		setPhase({ kind: "form" });
	};

	const field = (key: keyof ManualHostInput, label: string, keyboard: "default" | "number-pad" = "default") => (
		<View style={{ marginBottom: theme.spacing(3) }}>
			<Text style={{ color: c.textMuted, fontSize: 13, marginBottom: 4 }}>{label}</Text>
			<TextInput
				value={input[key]}
				onChangeText={(value) => setInput({ ...input, [key]: value })}
				autoCapitalize="none"
				autoCorrect={false}
				keyboardType={keyboard}
				style={{ color: c.text, backgroundColor: c.surfaceRaised, borderRadius: theme.radius.small, paddingHorizontal: theme.spacing(3), minHeight: theme.touch, fontSize: 15 }}
			/>
			{errors[key] ? <Text style={{ color: c.danger, fontSize: 13, marginTop: 4 }}>{errors[key]}</Text> : null}
		</View>
	);
	const mono = (text: string) => (
		<Text selectable style={{ color: c.text, fontFamily: theme.font.mono, fontSize: 13 }}>
			{text}
		</Text>
	);

	return (
		<Screen>
			<View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing(2), paddingVertical: theme.spacing(2) }}>
				<Pressable onPress={() => router.back()} accessibilityLabel={t.session.back} style={{ width: theme.touch, height: theme.touch, alignItems: "center", justifyContent: "center" }}>
					<Ionicons name="chevron-back" size={26} color={c.accentText} />
				</Pressable>
				<View>
					<Text style={{ color: c.textMuted, fontSize: 13 }}>
						{t.computers.title} › {t.add.title}
					</Text>
					<Text style={{ color: c.text, fontSize: 19, fontWeight: "700" }}>{t.add.manualTitle}</Text>
				</View>
			</View>
			<ScrollView contentContainerStyle={{ paddingBottom: theme.spacing(10) }} keyboardShouldPersistTaps="handled">
				{phase.kind === "confirm" ? (
					<>
						<SectionTitle>{t.add.identityTitle}</SectionTitle>
						<Card>
							{mono(phase.fingerprint)}
							<Text style={{ color: c.textMuted, fontSize: 14, marginVertical: theme.spacing(3) }}>{t.add.identityHint}</Text>
							{mono(t.add.identityLinux)}
							<View style={{ height: theme.spacing(2) }} />
							{mono(t.add.identityWindows)}
						</Card>
						<PrimaryButton label={t.add.itIsMine} onPress={() => void confirm(phase.details, phase.fingerprint)} />
						<Pressable onPress={() => setPhase({ kind: "rejected" })} style={{ minHeight: theme.touch, alignItems: "center", justifyContent: "center" }}>
							<Text style={{ color: c.danger, fontSize: 15, fontWeight: "600" }}>{t.add.notMine}</Text>
						</Pressable>
					</>
				) : phase.kind === "rejected" ? (
					<Card>
						<Text style={{ color: c.danger, fontSize: 16, fontWeight: "700" }}>{t.add.notMine}</Text>
						<Text style={{ color: c.text, fontSize: 15, marginTop: theme.spacing(2) }}>{t.add.notMineHint}</Text>
					</Card>
				) : (
					<>
						<SectionTitle>{t.add.keyTitle}</SectionTitle>
						<Card>
							{publicKey ? mono(publicKey) : <ActivityIndicator color={c.accentText} />}
							<Text style={{ color: c.textMuted, fontSize: 14, marginVertical: theme.spacing(3) }}>{t.add.keyHint}</Text>
							{mono(t.add.keyLinux)}
							{mono(t.add.keyWindows)}
							{mono(t.add.keyWindowsUser)}
							<Pressable
								onPress={() => void Clipboard.setStringAsync(publicKey).then(() => setCopied(true))}
								disabled={!publicKey}
								accessibilityRole="button"
								style={{ marginTop: theme.spacing(3), minHeight: theme.touch, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.accentText }}
							>
								<Text style={{ color: c.accentText, fontWeight: "700" }}>{copied ? t.add.copied : t.add.copyKey}</Text>
							</Pressable>
						</Card>
						<SectionTitle>{t.add.detailsTitle}</SectionTitle>
						<Card>
							{field("name", t.add.name)}
							{field("address", t.add.address)}
							{field("user", t.add.user)}
							{field("sshPort", t.add.port, "number-pad")}
							{failure ? <Text style={{ color: c.danger, fontSize: 14 }}>{failure}</Text> : null}
						</Card>
						{phase.kind === "checking" || phase.kind === "saving" ? (
							<ActivityIndicator color={c.accentText} style={{ marginTop: theme.spacing(4) }} />
						) : (
							<PrimaryButton label={t.add.checkIdentity} onPress={() => void check()} />
						)}
					</>
				)}
			</ScrollView>
		</Screen>
	);
}
