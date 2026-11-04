// Small building blocks shared by the screens.
import type { ReactNode } from "react";
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SessionStatus } from "../core/session-list";
import { usePreferences } from "./preferences";

export function Screen({ title, children, footer, headerRight }: { title?: string; children: ReactNode; footer?: ReactNode; headerRight?: ReactNode }) {
	const { theme } = usePreferences();
	const insets = useSafeAreaInsets();
	const window = useWindowDimensions();
	return (
		<View style={{ flex: 1, backgroundColor: theme.colors.background, paddingTop: insets.top }}>
			{/* Pre-rendered top glow (design/marca/make_icons.py geometry): Android ignores the CSS gradient's off-screen origin. */}
			<Image source={require("../../assets/brand/glow.png")} accessible={false} resizeMode="stretch" style={{ position: "absolute", top: 0, left: 0, width: window.width, height: window.height }} />
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
	return (
		<View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: theme.spacing(4), paddingTop: theme.spacing(4), paddingBottom: theme.spacing(2) }}>
			<Text style={{ color: theme.colors.textMuted, fontSize: 13, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }}>{children}</Text>
			{right}
		</View>
	);
}

export function Card({ children, onPress, style }: { children: ReactNode; onPress?: () => void; style?: ViewStyle }) {
	const { theme } = usePreferences();
	const base: ViewStyle = {
		backgroundColor: theme.colors.card,
		borderColor: theme.colors.border,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: theme.radius.medium,
		padding: theme.spacing(4),
		marginHorizontal: theme.spacing(4),
		marginBottom: theme.spacing(2),
		minHeight: theme.touch,
	};
	if (!onPress) return <View style={[base, style]}>{children}</View>;
	return (
		<Pressable onPress={onPress} style={({ pressed }) => [base, style, pressed && { backgroundColor: theme.colors.surfaceRaised }]}>
			{children}
		</Pressable>
	);
}

export function StatusPill({ status }: { status: SessionStatus }) {
	const { theme, t } = usePreferences();
	const color = theme.colors[status];
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start" }}>
			<View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color }} />
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
export function Segmented<T extends string | number>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }) {
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
						style={{ flex: 1, minHeight: 40, alignItems: "center", justifyContent: "center", borderRadius: theme.radius.small, backgroundColor: selected ? theme.colors.accent : "transparent" }}
					>
						<Text style={{ color: selected ? theme.colors.onAccent : theme.colors.textMuted, fontWeight: "700" }}>{option.label}</Text>
					</Pressable>
				);
			})}
		</View>
	);
}
