// App-wide preferences: theme, language, and prototype switches.
import { attachmentPreference } from "../services";
import { File, Paths } from "expo-file-system";
import type { AttachmentRetention } from "../core/attachment-retention";
import { getLocales } from "expo-localization";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { readGiftThemes, writeGiftThemes } from "../adapters/file-gift-themes";
import { readSubagentsMode, writeSubagentsMode } from "../adapters/file-subagents-mode";
import type { SubagentsMode } from "../core/subagents-mode";
import { type GiftThemeData, normalizeGiftCode, openGiftTheme, refreshUnlockedGifts, type UnlockedGift } from "../core/gift-themes";
import { sealedGifts } from "../core/gift-themes-sealed";
import { en, type Strings } from "./i18n/en";
import { es } from "./i18n/es";
import { giftTheme, type Theme, type ThemeId, type ThemeName, themes, resolveThemeName } from "./theme";

const themeFile = () => new File(Paths.document, "theme-preference.json");
function readTheme(unlockedGiftIds: readonly string[]): ThemeId {
 try { const file = themeFile(); return resolveThemeName(file.exists ? JSON.parse(file.textSync()) : null, unlockedGiftIds); }
 catch { return resolveThemeName(null); }
}
function writeTheme(name: ThemeId): void {
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
	setTheme: (name: ThemeId) => void;
	/** Gift themes unlocked on this phone. */
	gifts: UnlockedGift[];
	/** Opens a gift with its code and keeps it unlocked; the current theme stays as it is. */
	unlockGift: (code: string) => Promise<GiftThemeData | null>;
	language: LanguageChoice;
	locale: "es" | "en";
	setLanguage: (choice: LanguageChoice) => void;
	t: Strings;
	showEmpty: boolean;
	setShowEmpty: (value: boolean) => void;
	/** How Home shows subagents; saved on the phone. */
	subagentsMode: SubagentsMode;
	setSubagentsMode: (mode: SubagentsMode) => void;
};

const PreferencesContext = createContext<Preferences | null>(null);

export function PreferencesProvider({ children }: { children: ReactNode }) {
	const [retention, updateRetention] = useState(attachmentPreference.get);
	const setRetention = async (value: AttachmentRetention) => { await attachmentPreference.set(value); updateRetention(value); };
	const [gifts, updateGifts] = useState<UnlockedGift[]>(readGiftThemes);
	const giftsRef = useRef(gifts);
	const [themeName, updateTheme] = useState<ThemeId>(() => readTheme(gifts.map(gift => gift.theme.id)));
	const setTheme = (name: ThemeId) => { writeTheme(name); updateTheme(name); };
	const unlockGift = useCallback(async (code: string) => {
		const theme = await openGiftTheme(code, sealedGifts);
		if (!theme) return null;
		const gift = { code: normalizeGiftCode(code), theme };
		const current = giftsRef.current;
		const next = current.some(entry => entry.theme.id === theme.id) ? current.map(entry => (entry.theme.id === theme.id ? gift : entry)) : [...current, gift];
		giftsRef.current = next;
		updateGifts(next);
		// A failed write keeps the gift for this session; the code can be entered again later.
		void writeGiftThemes(next).catch(() => undefined);
		return theme;
	}, []);
	// An app update may ship newer versions of gifts unlocked before it: reopen them once in the background.
	useEffect(() => {
		let alive = true;
		void refreshUnlockedGifts(giftsRef.current, sealedGifts).then(({ changed, gifts: fresh }) => {
			if (!alive || !changed) return;
			// Merge by id so a gift unlocked meanwhile is kept.
			const next = giftsRef.current.map(entry => fresh.find(gift => gift.theme.id === entry.theme.id) ?? entry);
			giftsRef.current = next;
			updateGifts(next);
			void writeGiftThemes(next).catch(() => undefined);
		}).catch(() => undefined);
		return () => { alive = false; };
	}, []);
	const theme = useMemo(() => {
		const found = gifts.find(gift => gift.theme.id === themeName);
		if (themeName === "verde-profundo" || themeName === "oro-y-verde") return themes[themeName as ThemeName];
		return found ? giftTheme(found.theme) : themes["verde-profundo"];
	}, [gifts, themeName]);
	const [language, setLanguage] = useState<LanguageChoice>("system");
	const [showEmpty, setShowEmpty] = useState(false);
	const [subagentsMode, updateSubagentsMode] = useState<SubagentsMode>(readSubagentsMode);
	// A failed write keeps the choice for this session; it is chosen again next time.
	const setSubagentsMode = useCallback((mode: SubagentsMode) => { updateSubagentsMode(mode); void writeSubagentsMode(mode).catch(() => undefined); }, []);
	const value = useMemo<Preferences>(
		() => ({
			retention,
			setRetention,
			theme,
			setTheme,
			gifts,
			unlockGift,
			language,
			locale: language === "system" ? systemLanguage() : language,
			setLanguage,
			t: dictionaries[language === "system" ? systemLanguage() : language],
			showEmpty,
			setShowEmpty,
			subagentsMode,
			setSubagentsMode,
		}),
		[theme, gifts, unlockGift, language, showEmpty, retention, subagentsMode, setSubagentsMode],
	);
	return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
}

export function usePreferences(): Preferences {
	const value = useContext(PreferencesContext);
	if (!value) throw new Error("usePreferences must be used inside PreferencesProvider");
	return value;
}
