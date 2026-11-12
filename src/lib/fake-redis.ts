// Test helper: the small slice of the Upstash client the app uses, in memory. Values are JSON-cloned like the real client's serialisation.
export const store = {
	kv: new Map<string, string>(),
	sets: new Map<string, Set<string>>(),
	expiry: new Map<string, number>(),
	reset() {
		this.kv.clear();
		this.sets.clear();
		this.expiry.clear();
	},
};

export class FakeRedis {
	async set(key: string, value: unknown, opts?: { ex?: number }) {
		store.kv.set(key, JSON.stringify(value));
		if (opts?.ex) store.expiry.set(key, opts.ex);
		else store.expiry.delete(key);
		return "OK";
	}
	async get<T>(key: string): Promise<T | null> {
		const v = store.kv.get(key);
		return v === undefined ? null : (JSON.parse(v) as T);
	}
	async ttl(key: string) {
		return store.kv.has(key) ? (store.expiry.get(key) ?? -1) : -2;
	}
	async del(...keys: string[]) {
		for (const k of keys) {
			store.kv.delete(k);
			store.sets.delete(k);
			store.expiry.delete(k);
		}
		return keys.length;
	}
	async sadd(key: string, member: string) {
		const s = store.sets.get(key) ?? new Set<string>();
		s.add(member);
		store.sets.set(key, s);
		return 1;
	}
	async srem(key: string, member: string) {
		store.sets.get(key)?.delete(member);
		return 1;
	}
	async smembers(key: string) {
		return [...(store.sets.get(key) ?? [])];
	}
}
