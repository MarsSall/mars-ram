// «Ver qué pasa»: the most likely cause of a failed or stalled scan, its fix, and what the phone checked.
import { useState, type ReactNode } from "react";
import { Text, View } from "react-native";
import { computerCauses, type ComputerCause, type ComputerOs, type Diagnosis } from "../../core/connect-wizard";
import type { WizardNetwork } from "../../core/network-choice";
import type { PairingFailureCode } from "../../core/pairing";
import { zeroTierPhone, type PhoneNetworkState } from "../../core/phone-network";
import { PrimaryButton } from "../components";
import { CommandBlock } from "../install-help";
import { usePreferences } from "../preferences";
import { CheckRow, ErrorText, Kicker, Panel, PathText, QuietButton, SecondaryButton, StepTitle } from "./parts";
import { StepLayout } from "./phone-steps";
import { phoneActions } from "./use-phone-network";

type DiagnosisProps = {
	top: ReactNode;
	diagnosis: Diagnosis;
	network: PhoneNetworkState | null;
	/** The network the failed offer (or, while waiting, the wizard) used. */
	over: WizardNetwork;
	code?: PairingFailureCode;
	computerName?: string;
	os: ComputerOs;
	onRetry: () => void;
	onBackToComputer: () => void;
};

/** The phone's own checks, as read when the diagnosis opened. */
function PhoneChecks({ network, over, failure }: { network: PhoneNetworkState | null; over: WizardNetwork; failure?: string }) {
	const { t } = usePreferences();
	const w = t.wizard.checks;
	const zerotier = zeroTierPhone(network);
	return (
		<Panel>
			{!network ? (
				<CheckRow state="unknown" title={w.phoneUnknown} />
			) : over === "zerotier" ? (
				<CheckRow state={!zerotier ? "unknown" : zerotier.on ? "ok" : "missing"} title={!zerotier ? w.zerotierUnknown : !zerotier.installed ? w.zerotierMissing : zerotier.on ? w.zerotierOk : w.zerotierOff} />
			) : (
				<>
					<CheckRow state={network.tailscaleInstalled && network.tailscaleOn ? "ok" : "missing"} title={!network.tailscaleInstalled ? w.tailscaleMissing : network.tailscaleOn ? w.tailscaleOk : w.tailscaleOff} />
					<CheckRow state={network.privateDnsActive === null ? "unknown" : network.privateDnsActive ? "missing" : "ok"} title={network.privateDnsActive === null ? w.dnsUnknown : network.privateDnsActive ? w.dnsOn : w.dnsOk} />
				</>
			)}
			{failure ? <CheckRow state="missing" title={failure} /> : null}
		</Panel>
	);
}

export function DiagnosisView({ top, diagnosis, network, over, code, computerName, os, onRetry, onBackToComputer }: DiagnosisProps) {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	const d = t.wizard.diagnosis;
	const name = computerName ?? t.wizard.someComputer;
	const [openFailed, setOpenFailed] = useState(false);
	const open = (action: () => Promise<void>) => {
		setOpenFailed(false);
		action().catch(() => setOpenFailed(true));
	};
	const footer = (
		<>
			<PrimaryButton label={t.wizard.retry} onPress={onRetry} />
			<QuietButton label={t.wizard.backToComputer} onPress={onBackToComputer} />
		</>
	);
	const fixText = (text: string) => <Text style={{ color: c.textMuted, fontSize: 15 }}>{text}</Text>;
	const fixTitle = <Text style={{ color: c.text, fontSize: 16, fontWeight: "700" }}>{t.wizard.howToFix}</Text>;

	if (diagnosis === "check_computer") {
		const copy: Record<ComputerCause, { title: string; hint: string; command?: string }> = {
			account: { title: d.account, hint: d.accountHint },
			zerotier_network: { title: d.zerotierNetwork, hint: d.zerotierNetworkHint },
			zerotier_authorized: { title: d.zerotierAuthorized, hint: d.zerotierAuthorizedHint },
			firewall: { title: d.firewall, hint: d.firewallHint, command: t.wizard.firewallCommand },
			ssh: { title: d.sshTitle[os], hint: d.sshHint[os] },
			awake: { title: d.awake, hint: over === "zerotier" ? d.zerotierAwakeHint : d.awakeHint },
		};
		const causes = computerCauses(over, os).map((cause) => copy[cause]);
		return (
			<StepLayout top={top} footer={footer}>
				<View accessibilityRole="alert">
					<StepTitle lead={d.computerLead(name)}>{d.computerTitle}</StepTitle>
				</View>
				<Panel>
					{causes.map((cause, index) => (
						<View key={cause.title} style={{ flexDirection: "row", gap: theme.spacing(3), paddingVertical: theme.spacing(2), borderTopWidth: index === 0 ? 0 : 1, borderTopColor: c.border }}>
							<View accessible={false} style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: c.surfaceRaised, borderColor: c.border, borderWidth: 1, alignItems: "center", justifyContent: "center" }}>
								<Text style={{ color: c.textMuted, fontSize: 13, fontWeight: "700" }}>{index + 1}</Text>
							</View>
							<View style={{ flex: 1 }}>
								<Text style={{ color: c.text, fontSize: 15, fontWeight: "600" }}>{cause.title}</Text>
								<Text selectable style={{ color: c.textMuted, fontSize: 14 }}>{cause.hint}</Text>
								{cause.command ? <View style={{ marginTop: theme.spacing(2) }}><CommandBlock command={cause.command} /></View> : null}
							</View>
						</View>
					))}
				</Panel>
				<Panel>
					{fixText(d.doctor)}
					<CommandBlock command="mars-ram doctor" />
				</Panel>
				<Kicker>{t.wizard.checked}</Kicker>
				<PhoneChecks network={network} over={over} failure={t.wizard.checks.notReached(name)} />
			</StepLayout>
		);
	}

	if (diagnosis === "zerotier_off") {
		const missing = zeroTierPhone(network)?.installed === false;
		return (
			<StepLayout top={top} footer={footer}>
				<Kicker>{t.wizard.likely}</Kicker>
				<View accessibilityRole="alert">
					<StepTitle lead={d.zerotierLead}>{missing ? d.zerotierMissingTitle : d.zerotierTitle}</StepTitle>
				</View>
				<Panel tone="fix">
					{fixTitle}
					{fixText(missing ? d.zerotierMissingFix : d.zerotierFix)}
					<SecondaryButton label={missing ? t.wizard.installZeroTier : t.wizard.openZeroTier} icon="open-outline" onPress={() => open(missing ? phoneActions.installZeroTier : phoneActions.openZeroTier)} />
					<View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: theme.spacing(3), marginTop: theme.spacing(1) }}>
						<Text style={{ color: c.textMuted, fontSize: 14 }}>{t.wizard.oneVpn}</Text>
					</View>
				</Panel>
				{openFailed ? <ErrorText>{t.wizard.openFailed}</ErrorText> : null}
				<Kicker>{t.wizard.checked}</Kicker>
				<PhoneChecks network={network} over={over} failure={code === "NOT_ON_VPN" ? t.wizard.checks.notOnZeroTier(name) : undefined} />
			</StepLayout>
		);
	}

	const tailscale = diagnosis === "tailscale_off";
	const missing = tailscale && network?.tailscaleInstalled === false;
	return (
		<StepLayout top={top} footer={footer}>
			<Kicker>{t.wizard.likely}</Kicker>
			<View accessibilityRole="alert">
				<StepTitle lead={tailscale ? d.tailscaleLead : d.dnsLead}>{tailscale ? (missing ? d.tailscaleMissingTitle : d.tailscaleTitle) : d.dnsTitle}</StepTitle>
			</View>
			<Panel tone="fix">
				{fixTitle}
				{tailscale ? (
					<>
						{fixText(missing ? d.tailscaleMissingFix : d.tailscaleFix)}
						<SecondaryButton label={missing ? t.wizard.installTailscale : t.wizard.openTailscale} icon="open-outline" onPress={() => open(missing ? phoneActions.installTailscale : phoneActions.openTailscale)} />
					</>
				) : (
					<>
						{fixText(d.dnsFix)}
						<PathText>{t.wizard.dnsPath}</PathText>
						<SecondaryButton label={t.wizard.openDns} icon="open-outline" onPress={() => open(phoneActions.openPrivateDnsSettings)} />
						<View style={{ borderTopWidth: 1, borderTopColor: c.border, paddingTop: theme.spacing(3), marginTop: theme.spacing(1) }}>
							<Text style={{ color: c.textMuted, fontSize: 14 }}>{d.dnsAlt}</Text>
						</View>
					</>
				)}
			</Panel>
			{openFailed ? <ErrorText>{t.wizard.openFailed}</ErrorText> : null}
			<Kicker>{t.wizard.checked}</Kicker>
			<PhoneChecks network={network} over={over} failure={code === "PRIVATE_DNS" ? t.wizard.checks.notFoundByName(name) : undefined} />
		</StepLayout>
	);
}
