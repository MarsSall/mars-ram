// The computer step: the app cannot check it, so it gives the commands for the chosen system, ready to copy.
import type { ReactNode } from "react";
import { Text, View } from "react-native";
import { computerInstructions, type ComputerInstruction, type ComputerOs } from "../../core/connect-wizard";
import type { WizardNetwork } from "../../core/network-choice";
import { PrimaryButton } from "../components";
import { CommandBlock } from "../install-help";
import { usePreferences } from "../preferences";
import { PathText, StepTitle, Tabs } from "./parts";
import { StepLayout } from "./phone-steps";

const SYSTEMS: ComputerOs[] = ["linux", "macos", "windows"];

function Instruction({ item }: { item: ComputerInstruction }) {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	const text = (value: string) => <Text style={{ color: c.text, fontSize: 15 }}>{value}</Text>;
	const hint = (value: ReactNode) => <Text style={{ color: c.textMuted, fontSize: 14 }}>{value}</Text>;
	switch (item.kind) {
		case "node":
			return text(t.wizard.node);
		case "tailscale":
			return text(t.wizard.sameAccount);
		case "zerotier":
			return text(t.wizard.sameZeroTierNetwork);
		case "firewall":
			return (
				<View style={{ gap: theme.spacing(1) }}>
					{text(t.wizard.firewall)}
					<CommandBlock command={t.wizard.firewallCommand} />
				</View>
			);
		case "ssh":
			return (
				<View style={{ gap: 2 }}>
					{text(t.wizard.ssh[item.os])}
					{t.wizard.sshPath[item.os] ? <PathText>{t.wizard.sshPath[item.os]}</PathText> : null}
				</View>
			);
		case "command":
			return (
				<View style={{ gap: theme.spacing(1) }}>
					<CommandBlock command={item.command} />
					{item.alternative ? hint(<>{t.wizard.usingNpm} <Text style={{ fontFamily: theme.font.mono }}>{item.alternative}</Text></>) : null}
					{item.note === "admin" ? hint(t.wizard.pairAdmin) : item.note === "qr" ? hint(t.wizard.qrLasts) : null}
					{item.addressHint ? hint(t.wizard.pairAddress) : null}
				</View>
			);
	}
}

/** chooser: the network choice, so a wizard that opens here can still switch networks. */
export function ComputerStep({ top, os, onOs, onScan, choice, chooser }: { top: ReactNode; os: ComputerOs; onOs: (os: ComputerOs) => void; onScan: () => void; choice: WizardNetwork; chooser?: ReactNode }) {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	return (
		<StepLayout
			top={top}
			footer={<PrimaryButton label={t.wizard.seeQr} onPress={onScan} />}
		>
			{chooser}
			<StepTitle>{t.wizard.computerTitle}</StepTitle>
			<Tabs label={t.wizard.osLabel} options={SYSTEMS.map((value) => ({ value, label: t.wizard.os[value] }))} value={os} onChange={onOs} />
			<View style={{ paddingHorizontal: theme.spacing(4) }}>
				{computerInstructions(os, choice).map((item, index) => (
					<View key={index} style={{ flexDirection: "row", gap: theme.spacing(3), paddingVertical: theme.spacing(3), borderTopWidth: index === 0 ? 0 : 1, borderTopColor: c.border }}>
						<Text style={{ width: 20, color: c.textMuted, fontSize: 16, fontWeight: "700" }}>{index + 1}</Text>
						<View style={{ flex: 1, minWidth: 0 }}>
							<Instruction item={item} />
						</View>
					</View>
				))}
			</View>
		</StepLayout>
	);
}
