// «Agregar computadora» as a wizard (PRD R1): the network choice, phone checks that move on by themselves, the computer's commands, the scan, and a diagnosis when it fails.
import { useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler } from "react-native";
import { chooseNetwork, diagnose, goToStep, recheck, showsNetworkChoice, startWizard, wizardSteps, type ComputerOs, type Diagnosis, type WizardModel, type WizardStep } from "../../core/connect-wizard";
import type { WizardNetwork } from "../../core/network-choice";
import type { PhoneNetworkState } from "../../core/phone-network";
import { networkChoice } from "../../services";
import { usePreferences } from "../preferences";
import { ComputerStep } from "./computer-step";
import { DiagnosisView } from "./diagnosis";
import { NetworkChoiceStep, NetworkTabs } from "./network-choice";
import { usePairingRunner } from "./pairing-runner";
import { ProgressBar, WizardHeader } from "./parts";
import { DnsStep, ReadingPhone, TailscaleStep, ZeroTierStep } from "./phone-steps";
import { ScanStep } from "./scan-step";
import { usePhoneNetwork } from "./use-phone-network";

/** The steps the user went through, so back retraces them before leaving the screen. */
type Navigation = { model: WizardModel | null; history: WizardStep[] };
type DiagnosisState = null | { kind: "reading" } | { kind: "ready"; diagnosis: Diagnosis; network: PhoneNetworkState | null; over: WizardNetwork };

function advance(nav: Navigation, model: WizardModel): Navigation {
	if (!nav.model || model.step === nav.model.step) return { ...nav, model };
	return { model, history: [...nav.history, nav.model.step] };
}

/**
 * `start="scan"` opens the camera right away, for «Escanear código» entries; phone checks still load for the warnings.
 * The network is asked once, before the steps, and remembered; the first step and «Computadora» can change it.
 */
export function ConnectWizard({ start }: { start?: WizardStep }) {
	const router = useRouter();
	const { t } = usePreferences();
	const [choosing, setChoosing] = useState(() => !start && networkChoice.saved() === null);
	const initialChoice = useRef(networkChoice.current()).current;
	const [nav, setNav] = useState<Navigation>(() => ({ model: start ? startWizard(null, start, initialChoice) : null, history: [] }));
	const [os, setOs] = useState<ComputerOs>("linux");
	const [diagnosis, setDiagnosis] = useState<DiagnosisState>(null);
	const { phase, run, reset } = usePairingRunner();
	// The first read may arrive before or after the user picks a network on the choice screen.
	const latestRead = useRef<{ network: PhoneNetworkState | null } | null>(null);
	const { readNow } = usePhoneNetwork((network) => {
		latestRead.current = { network };
		setNav((current) => (current.model ? advance(current, recheck(current.model, network)) : { model: startWizard(network, undefined, networkChoice.current()), history: [] }));
	});

	const pickNetwork = (choice: WizardNetwork) => {
		void networkChoice.choose(choice);
		setChoosing(false);
		const read = latestRead.current;
		if (read) setNav({ model: startWizard(read.network, undefined, choice), history: [] });
	};
	const switchNetwork = (choice: WizardNetwork) => {
		void networkChoice.choose(choice);
		// The other network has other steps, so back starts over from its first one.
		setNav((current) => (current.model ? { model: chooseNetwork(current.model, choice), history: [] } : current));
	};

	const move = (step: WizardStep) => {
		if (step === "scan" && phase.kind === "failed") reset();
		setNav((current) => (current.model ? advance(current, goToStep(current.model, step)) : current));
	};
	const canGoBackInside = !choosing && (diagnosis !== null || nav.history.length > 0);
	const back = () => {
		if (choosing) return router.back();
		if (diagnosis) return setDiagnosis(null);
		if (nav.history.length === 0) return router.back();
		setNav((current) => (current.model ? { model: goToStep(current.model, current.history.at(-1)!), history: current.history.slice(0, -1) } : current));
	};
	// Android's back button retraces the wizard too.
	useEffect(() => {
		const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
			if (!canGoBackInside) return false;
			back();
			return true;
		});
		return () => subscription.remove();
	});

	const openDiagnosis = async () => {
		const trigger = phase.kind === "failed" ? { code: phase.code } : "slow";
		// A failed offer names its own network; while still waiting, the wizard's choice is the best guess.
		const over: WizardNetwork = phase.kind === "failed" ? (phase.network ?? "tailscale") : nav.model?.choice ?? "tailscale";
		setDiagnosis({ kind: "reading" });
		const network = await readNow();
		setDiagnosis({ kind: "ready", diagnosis: diagnose(trigger, network, over), network, over });
	};
	const closeDiagnosis = (step?: WizardStep) => {
		setDiagnosis(null);
		// A pairing that is still running keeps its waiting view; a failed one goes back to the camera.
		if (phase.kind === "failed") reset();
		if (step) move(step);
	};

	if (choosing) return <NetworkChoiceStep top={<WizardHeader subtitle={t.add.title} onBack={back} />} initial={initialChoice} onChoose={pickNetwork} />;
	const model = nav.model;
	if (!model) return <ReadingPhone top={<WizardHeader subtitle={t.add.title} onBack={back} />} />;
	const steps = wizardSteps(model);
	const position = t.wizard.step(steps.indexOf(model.step) + 1, steps.length);
	const failedView = diagnosis !== null;
	const top = (
		<>
			<WizardHeader subtitle={failedView ? `${position} · ${t.wizard.notConnected}` : position} onBack={back} onSkip={model.step === "scan" || failedView ? undefined : () => move("scan")} />
			<ProgressBar steps={steps} current={model.step} failed={failedView} />
		</>
	);

	if (diagnosis?.kind === "reading") return <ReadingPhone top={top} />;
	if (diagnosis?.kind === "ready") {
		return (
			<DiagnosisView
				top={top}
				diagnosis={diagnosis.diagnosis}
				network={diagnosis.network}
				over={diagnosis.over}
				code={phase.kind === "failed" ? phase.code : undefined}
				computerName={phase.kind === "idle" ? undefined : phase.computerName}
				os={os}
				onRetry={() => closeDiagnosis()}
				onBackToComputer={() => closeDiagnosis("computer")}
			/>
		);
	}
	const nextStep = () => move(steps[steps.indexOf(model.step) + 1] ?? "scan");
	const chooser = showsNetworkChoice(model) ? <NetworkTabs value={model.choice} onChange={switchNetwork} /> : undefined;
	switch (model.step) {
		case "tailscale":
			return <TailscaleStep top={top} network={model.network} onNext={nextStep} chooser={chooser} />;
		case "dns":
			return <DnsStep top={top} network={model.network} onNext={nextStep} />;
		case "zerotier":
			return <ZeroTierStep top={top} network={model.network} onNext={nextStep} chooser={chooser} />;
		case "computer":
			return <ComputerStep top={top} os={os} onOs={setOs} onScan={() => move("scan")} choice={model.choice} chooser={chooser} />;
		case "scan":
			return <ScanStep top={top} network={model.network} choice={model.choice} phase={phase} run={(uri) => void run(uri)} reset={reset} onDiagnose={() => void openDiagnosis()} onManual={() => router.push("/add-computer/manual")} />;
	}
}
