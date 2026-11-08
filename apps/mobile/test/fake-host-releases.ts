import type { HostReleaseRegistry, HostReleaseCache, ReleaseCacheEntry } from '../src/core/host-updates';
export class FakeHostReleaseRegistry implements HostReleaseRegistry {
 calls = 0;
 value: string | undefined = '0.1.4';
 fail = false;
 async latest(): Promise<unknown> { this.calls++; if (this.fail) throw Error('offline'); return this.value; }
}
export class FakeHostReleaseCache implements HostReleaseCache {
 value: ReleaseCacheEntry | undefined;
 async read() { return this.value; }
 async write(value: ReleaseCacheEntry) { this.value = value; }
}
