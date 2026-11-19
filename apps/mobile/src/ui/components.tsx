// Small building blocks shared by the screens.
import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SessionStatus } from "../core/session-list";
import { usePreferences } from "./preferences";
import type { Theme } from "./theme";
import { useFrameCycle } from "./use-reduced-motion";

/** One tile of the circuit backdrop, in points: thin traces and round nodes, repeated to cover the screen. */
export const CIRCUIT_TILE = {
	size: 96,
	lines: [
		{ left: 0, top: 24, width: 41, height: 1 }, { left: 40, top: 24, width: 1, height: 40 }, { left: 40, top: 64, width: 36, height: 1 },
		{ left: 72, top: 0, width: 1, height: 25 }, { left: 72, top: 24, width: 24, height: 1 }, { left: 16, top: 80, width: 1, height: 16 },
	],
	nodes: [{ x: 76, y: 64 }, { x: 72, y: 24 }, { x: 16, y: 80 }],
	node: 5,
} as const;

/** Faint circuit traces behind the content; decorative, so it takes no touches and is hidden from accessibility. */
function CircuitBackdrop({ width, height, colors }: { width: number; height: number; colors: Theme["colors"] }) {
	const { size, lines, nodes, node } = CIRCUIT_TILE;
	const columns = Math.ceil(width / size), rows = Math.ceil(height / size);
	const tiles: ReactNode[] = [];
	for (let row = 0; row < rows; row++) {
		for (let column = 0; column < columns; column++) {
			tiles.push(
				<View key={`${row}-${column}`} style={{ position: "absolute", left: column * size, top: row * size, width: size, height: size }}>
					{lines.map((line, i) => <View key={`l${i}`} style={{ position: "absolute", ...line, backgroundColor: colors.accent, opacity: 0.1 }} />)}
					{nodes.map((point, i) => <View key={`n${i}`} style={{ position: "absolute", left: point.x - node / 2, top: point.y - node / 2, width: node, height: node, borderRadius: node / 2, backgroundColor: colors.border, opacity: 0.18 }} />)}
				</View>,
			);
		}
	}
	return (
		<View testID="circuit-backdrop" pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={{ position: "absolute", top: 0, left: 0, width, height, overflow: "hidden" }}>
			{tiles}
		</View>
	);
}

export function Screen({ title, children, footer, headerRight }: { title?: string; children: ReactNode; footer?: ReactNode; headerRight?: ReactNode }) {
	const { theme } = usePreferences();
	const insets = useSafeAreaInsets();
	const window = useWindowDimensions();
	const circuit = theme.style?.backdrop === "circuit";
	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
			{/* Pre-rendered top glow (design/marca/make_icons.py geometry): Android ignores the CSS gradient's off-screen origin. */}
			<Image source={require("../../assets/brand/glow.png")} accessible={false} resizeMode="stretch" style={{ position: "absolute", top: 0, left: 0, width: window.width, height: window.height, ...(circuit ? { opacity: 0.55 } : {}) }} />
			{circuit ? <CircuitBackdrop width={window.width} height={window.height} colors={theme.colors} /> : null}
			{title ? (
				<View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: theme.spacing(4), paddingVertical: theme.spacing(3), gap: theme.spacing(2) }}>
					<Text accessibilityRole="header" style={{ flex: 1, color: theme.colors.text, fontSize: 28, fontWeight: "700" }}>{title}</Text>
					{headerRight}
				</View>
			) : null}
			<View style={{ flex: 1 }}>{children}</View>
			{footer}
		</View>
	);
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
	const { theme } = usePreferences();
	const mono = theme.style?.titles === "mono";
	const titleStyle = { color: theme.colors.textMuted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 } as const;
	return (
		<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(4), paddingBottom: theme.spacing(2) }}>
			{mono ? <Text style={[titleStyle, { fontFamily: theme.font.mono }]}>{"// "}{children}</Text> : <Text style={titleStyle}>{children}</Text>}
			{right}
		</View>
	);
}

const BRACKET = { length: 12, thickness: 2 };
/** HUD corner brackets (top-left, bottom-right): absolute, so they change neither layout nor touches. */
function HudBrackets({ color, radius }: { color: string; radius: number }) {
	const { length, thickness } = BRACKET;
	return [
		<View key="hud-tl" pointerEvents="none" accessible={false} style={{ position: "absolute", top: 0, left: 0, width: length, height: length, borderTopWidth: thickness, borderLeftWidth: thickness, borderTopLeftRadius: radius, borderColor: color }} />,
		<View key="hud-br" pointerEvents="none" accessible={false} style={{ position: "absolute", bottom: 0, right: 0, width: length, height: length, borderBottomWidth: thickness, borderRightWidth: thickness, borderBottomRightRadius: radius, borderColor: color }} />,
	];
}

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: ViewStyle }) {
	const { theme } = usePreferences();
	const hud = theme.style?.hud;
	const base: ViewStyle = {
		backgroundColor: theme.colors.card,
		// HUD cards: tighter corners and a faint border in the HUD color (≈30% alpha).
		borderColor: hud ? `${hud.color}4D` : theme.colors.border,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: hud ? theme.radius.small : theme.radius.medium,
		padding: theme.spacing(4),
		marginHorizontal: theme.spacing(4),
		marginBottom: theme.spacing(2),
		minHeight: theme.touch,
	};
	const brackets = hud ? HudBrackets({ color: hud.color, radius: theme.radius.small }) : null;
	if (!onPress) return <View style={[base, style]}>{children}{brackets}</View>;
	return (
		<Pressable onPress={onPress} style={({ pressed }) => [base, style, pressed && { backgroundColor: theme.colors.surfaceRaised }]}>
			{children}
			{brackets}
		</Pressable>
	);
}

const noFrames: readonly string[] = [];
export function StatusPill({ status }: { status: SessionStatus }) {
	const { theme, t } = usePreferences();
	const color = theme.colors[status];
	// Themes with their own working frames animate them in place of the dot (first frame with reduced motion).
	const working = status === "working" ? theme.working : undefined;
	const frame = useFrameCycle(working?.frames ?? noFrames, working?.intervalMs ?? 1000, working !== undefined);
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
			{working ? <Text accessible={false} importantForAccessibility="no" style={{ color, fontSize: 13, lineHeight: 16, minWidth: 12, textAlign: "center" }}>{frame}</Text> : <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />}
			<Text style={{ color, fontSize: 13, fontWeight: "600" }}>{t.status[status]}</Text>
		</View>
	);
}

export function EmptyState({ message, hint }: { message: string; hint?: string }) {
	const { theme } = usePreferences();
	return (
		<View style={{ padding: theme.spacing(8), alignItems: "center", gap: theme.spacing(2) }}>
			<Text style={{ color: theme.colors.text, fontSize: 16, textAlign: "center" }}>{message}</Text>
			{hint ? <Text style={{ color: theme.colors.textMuted, fontSize: 14, textAlign: "center" }}>{hint}</Text> : null}
		</View>
	);
}

export function PrimaryButton({ label, onPress, disabled = false }: { label: string; onPress: () => void; disabled?: boolean }) {
	const { theme } = usePreferences();
	return (
		<Pressable
			onPress={onPress}
			disabled={disabled}
			accessibilityState={{ disabled }}
			accessibilityRole="button"
			style={({ pressed }) => ({
				backgroundColor: theme.colors.accent,
				backgroundImage: theme.primaryFill.backgroundImage,
				shadowColor: theme.primaryFill.shadowColor,
				shadowOpacity: theme.primaryFill.shadowColor ? 0.65 : 0,
				shadowRadius: 18,
				shadowOffset: { width: 0, height: 0 },
				elevation: theme.primaryFill.shadowColor ? 6 : 0,
				opacity: disabled ? 0.4 : pressed ? 0.85 : 1,
				borderRadius: theme.radius.medium,
				minHeight: theme.touch + 4,
				alignItems: "center",
				justifyContent: "center",
				marginHorizontal: theme.spacing(4),
				marginVertical: theme.spacing(3),
			})}
		>
			<Text style={{ color: theme.colors.onAccent, fontSize: 16, fontWeight: "700" }}>{label}</Text>
		</Pressable>
	);
}

/** Two or more mutually exclusive options; the selected one is filled with the accent. */
export function Segmented<T extends string | number>({ options, value, onChange, compact = false }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void; compact?: boolean }) {
	const { theme } = usePreferences();
	return (
		<View style={{ flexDirection: "row", backgroundColor: theme.colors.surfaceRaised, borderRadius: theme.radius.medium, padding: 3 }}>
			{options.map((option) => {
				const selected = option.value === value;
				return (
					<Pressable
						key={option.value}
						onPress={() => onChange(option.value)}
						accessibilityRole="tab"
						accessibilityState={{ selected }}
						style={{ flex: compact ? Math.max(8, option.label.length) : 1, minHeight: compact ? 44 : 40, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.small, backgroundColor: selected ? theme.colors.accent : "transparent" }}
					>
						{/* Compact selectors share width by label length; larger accessibility text may still reflow. */}
						<Text style={{ color: selected ? theme.colors.onAccent : theme.colors.textMuted, fontWeight: "700", ...(compact ? { fontSize: 12, textAlign: "center" as const, paddingHorizontal: 2, paddingVertical: 6 } : {}) }}>{option.label}</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
