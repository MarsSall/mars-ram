import { Text, View } from 'react-native';
import { hostUpdateInstructions, type HostUpdate } from '../core/host-update';
import { CommandBlock } from './install-help';
import { usePreferences } from './preferences';
/** No loading/error UI: this optional check never takes over the computer's card. */
export function HostUpdateNotice({ update }: { update?: HostUpdate }) {
 const { t, theme } = usePreferences();
 if (!update || update.status === 'ok' || !update.target) return null;
 const required = update.status === 'required';
 const { command, manual } = hostUpdateInstructions(update.release, update.target);
 return <View style={{ marginHorizontal: theme.spacing(4), marginVertical: theme.spacing(2), gap: theme.spacing(2), borderLeftWidth: required ? 3 : 0, borderLeftColor: theme.colors.danger, paddingLeft: required ? theme.spacing(3) : 0 }}>
  <Text accessibilityRole={required ? 'alert' : undefined} style={{ color: required ? theme.colors.danger : theme.colors.textMuted, fontWeight: required ? '700' : '400', fontSize: required ? 15 : 13 }}>{required ? t.hostUpdate.required : t.hostUpdate.soft}</Text>
  <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>{manual ? t.hostUpdate.terminal : t.hostUpdate.terminalOne}</Text>
  {manual ? <Text style={{ color: theme.colors.textMuted, fontSize: 13 }}>{t.hostUpdate.manual}</Text> : null}
  <CommandBlock command={command} secondary={!required} />
 </View>;
}
