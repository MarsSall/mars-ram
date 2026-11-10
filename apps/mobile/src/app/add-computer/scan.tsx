import { ConnectWizard } from "../../ui/connect-wizard/wizard";

// The pairing link screen shares the scan's runner and waiting view.
export { PairingProgress, usePairingRunner, type PairingPhase } from "../../ui/connect-wizard/pairing-runner";

/** «Escanear código»: the wizard opened at its scan step, so a failed scan still gets a diagnosis. */
export default function ScanComputerScreen() {
	return <ConnectWizard start="scan" />;
}
