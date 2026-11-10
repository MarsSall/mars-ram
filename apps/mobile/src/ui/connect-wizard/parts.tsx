// Building blocks of the connection wizard (design/connect-tutorial/04-wizard-with-diagnosis.html).
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ComponentProps, ReactNode } from "react";
import { ActivityIndicator, Pressable, Text, View } from "react-native";
import type { WizardStep } from "../../core/connect-wizard";
import { usePreferences } from "../preferences";

export type CheckState = "ok" | "missing" | "unknown" | "running" | "pending";

/** The top bar: back, where the user is, and «Ya sé, escanear» when it applies. */
export function WizardHeader({ subtitle, onBack, onSkip }: { subtitle: string; onBack: () => void; onSkip?: () => void }) {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	return (
		<View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing(2), paddingTop: theme.spacing(2) }}>
			<Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t.session.back} style={{ width: theme.touch, height: theme.touch, alignItems: "center", justifyContent: "center" }}>
				<Ionicons name="chevron-back" size={26} color={c.accentText} />
			</Pressable>
			<View style={{ flex: 1 }}>
				<Text style={{ color: c.textMuted, fontSize: 13 }}>{t.add.title}</Text>
				<Text accessibilityRole="header" style={{ color: c.text, fontSize: 16, fontWeight: "700" }}>{subtitle}</Text>
			</View>
			{onSkip ? (
				<Pressable onPress={onSkip} accessibilityRole="button" style={{ minHeight: theme.touch, paddingHorizontal: theme.spacing(3), justifyContent: "center" }}>
					<Text style={{ color: c.accentText, fontSize: 14, fontWeight: "600" }}>{t.wizard.skipToScan}</Text>
				</Pressable>
			) : null}
		</View>
	);
}

/** One segment per step: done, current, still ahead, or failed (the scan, on a diagnosis). Read as a single progress value. */
export function ProgressBar({ steps, current, failed = false }: { steps: WizardStep[]; current: WizardStep; failed?: boolean }) {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	const index = steps.indexOf(current);
	const label = (failed ? t.wizard.progressFailed : t.wizard.progress)(index + 1, steps.length);
	return (
		<View accessible accessibilityRole="progressbar" accessibilityLabel={label} accessibilityValue={{ min: 1, max: steps.length, now: index + 1 }} style={{ flexDirection: "row", gap: 6, paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(1) }}>
			{steps.map((step, i) => {
				const isCurrent = i === index;
				const isFailed = failed && isCurrent;
				const done = i < index;
				const fill = isFailed ? c.danger : done ? c.accentText : c.surfaceRaised;
				const border = isFailed || done || isCurrent ? (isFailed ? c.danger : c.accentText) : c.border;
				return (
					<View key={step} style={{ flex: 1, gap: 4 }}>
						<View style={{ height: 6, borderRadius: 3, backgroundColor: fill, borderColor: border, borderWidth: isCurrent && !isFailed ? 2 : 1 }} />
						<Text numberOfLines={1} style={{ fontSize: 12, fontWeight: isFailed ? "700" : "600", color: isFailed ? c.text : isCurrent ? c.accentText : c.textMuted }}>
							{isFailed ? `✕ ${t.wizard.names[step]}` : t.wizard.names[step]}
						</Text>
					</View>
				);
			})}
		</View>
	);
}

export function StepTitle({ children, lead }: { children: ReactNode; lead?: ReactNode }) {
	const { theme } = usePreferences();
	return (
		<View style={{ paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(5), paddingBottom: theme.spacing(4), gap: theme.spacing(2) }}>
			<Text accessibilityRole="header" style={{ color: theme.colors.text, fontSize: 28, fontWeight: "700", lineHeight: 34 }}>{children}</Text>
			{lead ? <Text style={{ color: theme.colors.textMuted, fontSize: 16 }}>{lead}</Text> : null}
		</View>
	);
}

/** Small uppercase label above a group, as «Lo más probable». */
export function Kicker({ children }: { children: ReactNode }) {
	const { theme } = usePreferences();
	return <Text style={{ color: theme.colors.textMuted, fontSize: 13, fontWeight: "700", letterSpacing: 0.6, textTransform: "uppercase", paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(5), paddingBottom: theme.spacing(1) }}>{children}</Text>;
}

/** A card with a colored border: the fix on a diagnosis, the warning before scanning. */
export function Panel({ children, tone = "plain" }: { children: ReactNode; tone?: "plain" | "fix" | "warning" }) {
	const { theme } = usePreferences();
	const c = theme.colors;
	const border = tone === "fix" ? c.accentText : tone === "warning" ? c.attention : c.border;
	return <View style={{ backgroundColor: c.card, borderColor: border, borderWidth: 1, borderRadius: theme.radius.medium, padding: theme.spacing(4), marginHorizontal: theme.spacing(4), marginBottom: theme.spacing(2), gap: theme.spacing(2) }}>{children}</View>;
}

const ICONS: Record<Exclude<CheckState, "running">, ComponentProps<typeof Ionicons>["name"]> = {
	ok: "checkmark-circle-outline",
	missing: "close-circle-outline",
	unknown: "help-circle-outline",
	pending: "ellipse-outline",
};

/** One checked fact; screen readers hear its state before its title. */
export function CheckRow({ state, title, hint, children, live = false }: { state: CheckState; title: string; hint?: string; children?: ReactNode; live?: boolean }) {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	const color = { ok: c.done, missing: c.danger, unknown: c.textMuted, pending: c.textMuted, running: c.accentText }[state];
	return (
		<View accessibilityLiveRegion={live ? "polite" : "none"} style={{ flexDirection: "row", gap: theme.spacing(3), alignItems: "flex-start", paddingVertical: theme.spacing(2) }}>
			<View accessible={false} importantForAccessibility="no-hide-descendants" style={{ width: 26, height: 26, alignItems: "center", justifyContent: "center" }}>
				{state === "running" ? <ActivityIndicator color={color} /> : <Ionicons name={ICONS[state]} size={26} color={color} />}
			</View>
			<View style={{ flex: 1, gap: 2 }}>
				<View accessible accessibilityLabel={`${t.wizard.state[state]}: ${title}${hint ? `. ${hint}` : ""}`}>
					<Text style={{ color: c.text, fontSize: 16, fontWeight: "600" }}>{title}</Text>
					{hint ? <Text style={{ color: c.textMuted, fontSize: 14 }}>{hint}</Text> : null}
				</View>
				{children}
			</View>
		</View>
	);
}

/** Outlined action inside a card, like «Ver qué pasa» or «Abrir ajustes de DNS». */
export function SecondaryButton({ label, onPress, icon }: { label: string; onPress: () => void; icon?: ComponentProps<typeof Ionicons>["name"] }) {
	const { theme } = usePreferences();
	const c = theme.colors;
	return (
		<Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: theme.spacing(2), minHeight: theme.touch, paddingHorizontal: theme.spacing(3), borderRadius: theme.radius.medium, borderWidth: 1, borderColor: c.accentText, opacity: pressed ? 0.85 : 1 })}>
			<Text style={{ color: c.accentText, fontSize: 16, fontWeight: "700" }}>{label}</Text>
			{icon ? <Ionicons name={icon} size={18} color={c.accentText} /> : null}
		</Pressable>
	);
}

/** Full-width low-emphasis action under the primary one. */
export function QuietButton({ label, onPress, role = "button" }: { label: string; onPress: () => void; role?: "button" | "link" }) {
	const { theme } = usePreferences();
	return (
		<Pressable onPress={onPress} accessibilityRole={role} style={{ minHeight: theme.touch, alignItems: "center", justifyContent: "center", paddingHorizontal: theme.spacing(4) }}>
			<Text style={{ color: theme.colors.textMuted, fontSize: 16, textAlign: "center" }}>{label}</Text>
		</Pressable>
	);
}

/** Mutually exclusive choices with 48 dp targets (the shared Segmented control is 40 dp). */
export function Tabs<T extends string>({ label, options, value, onChange }: { label: string; options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
	const { theme } = usePreferences();
	const c = theme.colors;
	return (
		<View accessibilityRole="tablist" accessibilityLabel={label} style={{ flexDirection: "row", gap: 3, padding: 3, backgroundColor: c.surfaceRaised, borderRadius: theme.radius.medium, marginHorizontal: theme.spacing(4), marginBottom: theme.spacing(3) }}>
			{options.map((option) => {
				const selected = option.value === value;
				return (
					<Pressable key={option.value} onPress={() => onChange(option.value)} accessibilityRole="tab" accessibilityState={{ selected }} style={{ flex: 1, minHeight: theme.touch, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.small, backgroundColor: selected ? c.accent : "transparent" }}>
						<Text style={{ color: selected ? c.onAccent : c.textMuted, fontSize: 16, fontWeight: "700" }}>{option.label}</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

/** «Ajustes › …» paths and other text the user follows by hand. */
export function PathText({ children }: { children: ReactNode }) {
	const { theme } = usePreferences();
	return <Text selectable style={{ color: theme.colors.text, fontSize: 14 }}>{children}</Text>;
}

/** Text that came from an action that may fail, like opening another app; read out when it appears. */
export function ErrorText({ children }: { children: ReactNode }) {
	const { theme } = usePreferences();
	return <Text accessibilityLiveRegion="polite" style={{ color: theme.colors.danger, fontSize: 14, paddingHorizontal: theme.spacing(4) }}>{children}</Text>;
}
