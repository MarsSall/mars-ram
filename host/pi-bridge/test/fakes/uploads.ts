import type { ResolvedUpload, UploadStorePort } from "../../src/core/ports.ts";

/** Uploads by name, as the adapter would resolve them inside the uploads folder. */
export class FakeUploads implements UploadStorePort {
	files = new Map<string, ResolvedUpload & { data: string }>();
	readFails = false;

	add(name: string, options: { mimeType?: string | null; size?: number; data?: string } = {}) {
		this.files.set(name, { path: `/home/u/.mars-ram/uploads/${name}`, mimeType: options.mimeType ?? null, size: options.size ?? 10, data: options.data ?? "AAAA" });
	}

	async resolve(name: string): Promise<ResolvedUpload | null> {
		const file = this.files.get(name);
		return file ? { path: file.path, mimeType: file.mimeType, size: file.size } : null;
	}

	async readBase64(path: string): Promise<string> {
		if (this.readFails) throw new Error(`EACCES ${path}`);
		const file = [...this.files.values()].find((f) => f.path === path);
		if (!file) throw new Error(`ENOENT ${path}`);
		return file.data;
	}
}
