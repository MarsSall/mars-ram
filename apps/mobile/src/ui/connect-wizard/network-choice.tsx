// «¿Qué red usás?»: asked once before the steps, then changeable from the first step and «Computadora» (odd/tasks/zerotier.md S6).
import Ionicons from "@expo/vector-icons/Ionicons";
import { useState, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import type { WizardNetwork } from "../../core/network-choice";
import { PrimaryButton } from "../components";
import { usePreferences } from "../preferences";
import { StepTitle, Tabs } from "./parts";
import { StepLayout } from "./phone-steps";

const NETWORKS: WizardNetwork[] = ["tailscale", "zerotier"];

/** The first time the wizard opens: Tailscale is preselected; «Siguiente» keeps the pick for the next time. */
export function NetworkChoiceStep({ top, initial, onChoose }: { top: ReactNode; initial: WizardNetwork; onChoose: (network: WizardNetwork) => void }) {
	const { theme, t } = usePreferences();
	const c = theme.colors;
	const [selected, setSelected] = useState(initial);
	return (
		<StepLayout top={top} footer={<PrimaryButton label={t.wizard.next} onPress={() => onChoose(selected)} />}>
			<StepTitle lead={t.wizard.choiceLead}>{t.wizard.choiceTitle}</StepTitle>
			<View accessibilityRole="radiogroup" accessibilityLabel={t.wizard.networkLabel} style={{ gap: theme.spacing(2), paddingHorizontal: theme.spacing(4) }}>
				{NETWORKS.map((network) => {
					const checked = network === selected;
					const choice = t.wizard.choices[network];
					return (
						<Pressable
							key={network}
							onPress={() => setSelected(network)}
							accessibilityRole="radio"
							accessibilityState={{ checked }}
							accessibilityLabel={`${choice.title}. ${choice.hint}`}
							style={{ flexDirection: "row", gap: theme.spacing(3), alignItems: "flex-start", minHeight: theme.touch, padding: theme.spacing(4), borderRadius: theme.radius.medium, borderWidth: checked ? 2 : 1, borderColor: checked ? c.accentText : c.border, backgroundColor: c.card }}
						>
							<Ionicons name={checked ? "radio-button-on" : "radio-button-off"} size={24} color={checked ? c.accentText : c.textMuted} accessible={false} />
							<View style={{ flex: 1, gap: 2 }}>
								<Text style={{ color: c.text, fontSize: 16, fontWeight: "700" }}>{choice.title}</Text>
								<Text style={{ color: c.textMuted, fontSize: 14 }}>{choice.hint}</Text>
							</View>
						</Pressable>
					);
				})}
			</View>
		</StepLayout>
	);
}

/** On the first step and «Computadora»: switching shows the other network's steps. */
export function NetworkTabs({ value, onChange }: { value: WizardNetwork; onChange: (network: WizardNetwork) => void }) {
	const { theme, t } = usePreferences();
	return (
		<View style={{ paddingTop: theme.spacing(4) }}>
			<Tabs label={t.wizard.networkLabel} options={NETWORKS.map((network) => ({ value: network, label: t.wizard.networks[network] }))} value={value} onChange={onChange} />
		</View>
	);
}
