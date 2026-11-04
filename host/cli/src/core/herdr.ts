// Kept in sync with the phone/native Herdr-only command boundary.
export function validHerdrPath(value: unknown): value is string {
 if (typeof value !== "string") return false;
 if (value === "herdr") return true;
 if (!/^(?:\/|[A-Za-z]:\\)/.test(value) || !/^[A-Za-z0-9._/\\: -]+$/.test(value)) return false;
 const parts = value.split(/[/\\]/);
 return !parts.includes("..") && /^(?:herdr|herdr\.exe)$/.test(parts.at(-1) ?? "");
}
