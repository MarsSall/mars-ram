// The phone steps: Tailscale, and Private DNS only when it gets in the way; or ZeroTier. All re-check when the user comes back.
import { useState, type ReactNode } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { stepCheck } from "../../core/connect-wizard";
import { zeroTierPhone, type PhoneNetworkState } from "../../core/phone-network";
import { PrimaryButton, Screen } from "../components";
import { usePreferences } from "../preferences";
import { CheckRow, ErrorText, Panel, PathText, QuietButton, StepTitle } from "./parts";
import { phoneActions } from "./use-phone-network";

/** Header and progress on top, scrolling content, and the step's actions at the bottom within thumb reach. */
export function StepLayout({ top, footer, children }: { top: ReactNode; footer?: ReactNode; children: ReactNode }) {
	const { theme } = usePreferences();
	return (
		<Screen footer={footer ? <View style={{ paddingBottom: theme.spacing(3) }}>{footer}</View> : undefined}>
			{top}
			<ScrollView contentContainerStyle={{ paddingBottom: theme.spacing(4) }}>{children}</ScrollView>
		</Screen>
	);
}

/** Before the first read finishes. */
export function ReadingPhone({ top }: { top: ReactNode }) {
	const { theme, t } = usePreferences();
	return (
		<StepLayout top={top}>
			<View accessibilityLiveRegion="polite" style={{ padding: theme.spacing(8), alignItems: "center", gap: theme.spacing(3) }}>
				<ActivityIndicator color={theme.colors.accentText} />
				<Text style={{ color: theme.colors.text, fontSize: 16 }}>{t.wizard.reading}</Text>
			</View>
		</StepLayout>
	);
}

/** Opening another app or a system screen can fail; say so instead of doing nothing. */
function useOpener() {
	const [failed, setFailed] = useState(false);
	const open = (action: () => Promise<void>) => {
		setFailed(false);
		action().catch(() => setFailed(true));
	};
	return { failed, open };
}

/** chooser: the network choice; phone steps get it only as the network's first step. */
type PhoneStepProps = { top: ReactNode; network: PhoneNetworkState | null; onNext: () => void; chooser?: ReactNode };

export function TailscaleStep({ top, network, onNext, chooser }: PhoneStepProps) {
	const { theme, t } = usePreferences();
	const { failed, open } = useOpener();
	const check = stepCheck("tailscale", network);
	let rows: ReactNode;
	let primary: ReactNode;
	if (!network) {
		rows = <CheckRow state="unknown" title={t.wizard.unreadable} />;
		primary = <PrimaryButton label={t.wizard.next} onPress={onNext} />;
	} else if (!network.tailscaleInstalled) {
		rows = <CheckRow state="missing" title={t.wizard.notInstalled} hint={t.wizard.notInstalledHint} />;
		primary = <PrimaryButton label={t.wizard.installTailscale} onPress={() => open(phoneActions.installTailscale)} />;
	} else {
		rows = (
			<>
				<CheckRow state="ok" title={t.wizard.installed} />
				<View style={{ height: 1, backgroundColor: theme.colors.border }} />
				{network.tailscaleOn ? <CheckRow state="ok" title={t.wizard.on} /> : <CheckRow state="missing" title={t.wizard.off} hint={t.wizard.offHint} />}
			</>
		);
		primary = network.tailscaleOn ? <PrimaryButton label={t.wizard.next} onPress={onNext} /> : <PrimaryButton label={t.wizard.openTailscale} onPress={() => open(phoneActions.openTailscale)} />;
	}
	return (
		<StepLayout top={top} footer={<>{primary}{check === "fail" ? <QuietButton label={t.wizard.skipStep} onPress={onNext} /> : null}</>}>
			{chooser}
			<StepTitle lead={t.wizard.tailscaleLead}>{t.wizard.tailscaleTitle}</StepTitle>
			<Panel>
				<View accessibilityLiveRegion="polite">{rows}</View>
			</Panel>
			{failed ? <ErrorText>{t.wizard.openFailed}</ErrorText> : null}
		</StepLayout>
	);
}

/** ZeroTier installed and on. "On" is inferred: a VPN is active without a Tailscale address (Android does not name the VPN's app). */
export function ZeroTierStep({ top, network, onNext, chooser }: PhoneStepProps) {
	const { theme, t } = usePreferences();
	const { failed, open } = useOpener();
	const check = stepCheck("zerotier", network);
	const zerotier = zeroTierPhone(network);
	let rows: ReactNode;
	let primary: ReactNode;
	if (!zerotier) {
		rows = <CheckRow state="unknown" title={t.wizard.unreadable} />;
		primary = <PrimaryButton label={t.wizard.next} onPress={onNext} />;
	} else if (!zerotier.installed) {
		rows = <CheckRow state="missing" title={t.wizard.notInstalled} hint={t.wizard.notInstalledHint} />;
		primary = <PrimaryButton label={t.wizard.installZeroTier} onPress={() => open(phoneActions.installZeroTier)} />;
	} else {
		rows = (
			<>
				<CheckRow state="ok" title={t.wizard.installed} />
				<View style={{ height: 1, backgroundColor: theme.colors.border }} />
				{zerotier.on ? <CheckRow state="ok" title={t.wizard.on} /> : <CheckRow state="missing" title={t.wizard.off} hint={network?.tailscaleOn ? t.wizard.zerotierTailscaleActive : t.wizard.offHint} />}
			</>
		);
		primary = zerotier.on ? <PrimaryButton label={t.wizard.next} onPress={onNext} /> : <PrimaryButton label={t.wizard.openZeroTier} onPress={() => open(phoneActions.openZeroTier)} />;
	}
	return (
		<StepLayout top={top} footer={<>{primary}{check === "fail" ? <QuietButton label={t.wizard.skipStep} onPress={onNext} /> : null}</>}>
			{chooser}
			<StepTitle lead={t.wizard.zerotierLead}>{t.wizard.zerotierTitle}</StepTitle>
			<Panel>
				<View accessibilityLiveRegion="polite">{rows}</View>
			</Panel>
			<Panel>
				<Text style={{ color: theme.colors.textMuted, fontSize: 14 }}>{t.wizard.oneVpn}</Text>
			</Panel>
			{failed ? <ErrorText>{t.wizard.openFailed}</ErrorText> : null}
		</StepLayout>
	);
}

export function DnsStep({ top, network, onNext }: PhoneStepProps) {
	const { t } = usePreferences();
	const { failed, open } = useOpener();
	const check = stepCheck("dns", network);
	return (
		<StepLayout
			top={top}
			footer={
				check === "fail" ? (
					<>
						<PrimaryButton label={t.wizard.openDns} onPress={() => open(phoneActions.openPrivateDnsSettings)} />
						<QuietButton label={t.wizard.skipStep} onPress={onNext} />
					</>
				) : (
					<PrimaryButton label={t.wizard.next} onPress={onNext} />
				)
			}
		>
			<StepTitle lead={t.wizard.dnsLead}>{t.wizard.dnsTitle}</StepTitle>
			<Panel>
				<View accessibilityLiveRegion="polite">
					{check === "fail" ? <CheckRow state="missing" title={t.wizard.dnsOn} hint={t.wizard.dnsOnHint} /> : check === "pass" ? <CheckRow state="ok" title={t.wizard.dnsOff} /> : <CheckRow state="unknown" title={t.wizard.unreadable} />}
				</View>
			</Panel>
			<Panel>
				<PathLabel />
				<PathText>{t.wizard.dnsPath}</PathText>
			</Panel>
			{failed ? <ErrorText>{t.wizard.openFailed}</ErrorText> : null}
		</StepLayout>
	);
}

function PathLabel() {
	const { theme, t } = usePreferences();
	return <Text style={{ color: theme.colors.textMuted, fontSize: 14 }}>{t.wizard.dnsWhere}</Text>;
}
