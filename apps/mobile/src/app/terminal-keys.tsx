// Ajustes › Terminal › «Personalizar teclas»: the bar, the D-pad and custom buttons for every computer.
import { useRouter } from "expo-router";
import { TerminalKeysEditor } from "../ui/terminal-keys-editor";

export default function TerminalKeysScreen() {
 const router = useRouter();
 return <TerminalKeysEditor close={() => router.back()} />;
}
