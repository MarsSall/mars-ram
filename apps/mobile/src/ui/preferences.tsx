// App-wide preferences: theme, language, and prototype switches.
import { attachmentPreference } from "../services";
import { File, Paths } from "expo-file-system";
import type { AttachmentRetention } from "../core/attachment-retention";
import { getLocales } from "expo-localization";
import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { en, type Strings } from "./i18n/en";
import { es } from "./i18n/es";
import { type Theme, type ThemeName, themes, resolveThemeName } from "./theme";

const themeFile = () => new File(Paths.document, "theme-preference.json");
function readTheme(): ThemeName {
 try { const file = themeFile(); return resolveThemeName(file.exists ? JSON.parse(file.textSync()) : null); }
 catch { return resolveThemeName(null); }
}
function writeTheme(name: ThemeName): void {
 try { const file = themeFile(); if (!file.exists) file.create(); file.write(JSON.stringify(name)); }
 catch { /* Keep the current selection usable if storage is unavailable. */ }
}

export type LanguageChoice = "system" | "es" | "en";

const dictionaries = { es, en };

function systemLanguage(): "es" | "en" {
	return getLocales()[0]?.languageCode === "es" ? "es" : "en";
}

type Preferences = {
	retention: AttachmentRetention;
	setRetention: (value: AttachmentRetention) => Promise<void>;
	theme: Theme;
	setTheme: (name: ThemeName) => void;
	language: LanguageChoice;
	setLanguage: (choice: LanguageChoice) => void;
	t: Strings;
	showEmpty: boolean;
	setShowEmpty: (value: boolean) => void;
};

const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
	const [retention, updateRetention] = useState(attachmentPreference.get);
	const setRetention = async (value: AttachmentRetention) => { await attachmentPreference.set(value); updateRetention(value); };
	const [themeName, updateTheme] = useState<ThemeName>(readTheme);
	const setTheme = (name: ThemeName) => { writeTheme(name); updateTheme(name); };
	const [language, setLanguage] = useState<LanguageChoice>("system");
	const [showEmpty, setShowEmpty] = useState(false);
	const value = useMemo<Preferences>(
		() => ({
			retention,
			setRetention,
			theme: themes[themeName],
			setTheme,
			language,
			setLanguage,
			t: dictionaries[language === "system" ? systemLanguage() : language],
			showEmpty,
			setShowEmpty,
		}),
		[themeName, language, showEmpty, retention],
	);
	return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
	const value = useContext(PreferencesContext);
	if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
	return value;
}
