export const PRIVACY_URL = "https://marssall.github.io/mars-ram/privacy";
export const SOURCE_URL = "https://github.com/MarsSall/mars-ram";

export function privacyUrl(language: "system" | "es" | "en", systemLanguage: string | undefined): string {
 return (language === "system" ? systemLanguage : language) === "es" ? `${PRIVACY_URL}.es` : PRIVACY_URL;
}
