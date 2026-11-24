import { getSecretsCacheDuration } from "../commonConfig";
import type { SecretClient } from "@azure/keyvault-secrets";
import type { TokenCredential } from "@azure/identity";

interface CacheEntry {
	value: string;
	fetchedAt: number;
}

interface TargetRef {
	variableId: string;
	variableName: string;
	provider?: string;
	profile: string;
	secretName: string;
	jsonProperty?: string;
}

const VAULT_NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9-]{1,22}[a-zA-Z0-9]$/;
const SECRET_NAME_REGEX = /^[0-9a-zA-Z-]{1,127}$/;
const KEY_VAULT_SCOPE = "https://vault.azure.net/.default";

const secretCache = new Map<string, CacheEntry>();
const clientCache = new Map<string, Promise<SecretClient>>();
let credentialPromise: Promise<TokenCredential> | undefined;

function cacheKey(vault: string, secretName: string): string {
	return `${vault.toLowerCase()}::${secretName}`;
}

function errorMessage(e: any): string {
	return e?.message ?? String(e);
}

function isCacheEntryValid(
	hit: CacheEntry | undefined,
	ttl: number,
): hit is CacheEntry {
	if (!hit) {
		return false;
	}
	if (ttl === 0) {
		return true;
	}
	return Date.now() - hit.fetchedAt < ttl;
}

function getCredential(): Promise<TokenCredential> {
	if (!credentialPromise) {
		credentialPromise = import("@azure/identity")
			.then(({ DefaultAzureCredential }) => new DefaultAzureCredential())
			.catch((e) => {
				credentialPromise = undefined;
				throw e;
			});
	}
	return credentialPromise;
}

function assertValidVault(vault: string) {
	// Restricting the name prevents redirecting requests to an arbitrary host.
	if (!VAULT_NAME_REGEX.test(vault)) {
		throw new Error(
			`Invalid Key Vault name "${vault}". Use 3-24 letters, digits or hyphens.`,
		);
	}
}

function getClient(vault: string): Promise<SecretClient> {
	assertValidVault(vault);
	const key = vault.toLowerCase();
	let client = clientCache.get(key);
	if (!client) {
		client = (async () => {
			const [{ SecretClient }, credential] = await Promise.all([
				import("@azure/keyvault-secrets"),
				getCredential(),
			]);
			return new SecretClient(`https://${key}.vault.azure.net`, credential);
		})();
		client.catch(() => clientCache.delete(key));
		clientCache.set(key, client);
	}
	return client;
}

async function checkVault(vault: string) {
	try {
		assertValidVault(vault);
		const credential = await getCredential();
		await credential.getToken(KEY_VAULT_SCOPE);
		return { vault, ok: true as const, error: undefined as string };
	} catch (e: any) {
		return { vault, ok: false as const, error: errorMessage(e) };
	}
}

async function fetchSecret(vault: string, secretName: string) {
	if (!SECRET_NAME_REGEX.test(secretName)) {
		throw new Error(
			`Invalid secret name "${secretName}". Use letters, digits or hyphens.`,
		);
	}
	const client = await getClient(vault);
	const res = await client.getSecret(secretName);
	return res.value ?? "";
}

export async function getSecretCached(
	vault: string,
	secretName: string,
): Promise<{ ok: boolean; raw: string; cached: boolean }> {
	const key = cacheKey(vault, secretName);
	const hit = secretCache.get(key);
	if (isCacheEntryValid(hit, getSecretsCacheDuration())) {
		return { ok: true, raw: hit.value, cached: true };
	}
	try {
		const raw = await fetchSecret(vault, secretName);
		secretCache.set(key, { value: raw, fetchedAt: Date.now() });
		return { ok: true, raw, cached: false };
	} catch (e: any) {
		return { ok: false, raw: errorMessage(e), cached: false };
	}
}

async function checkVaults(targets: TargetRef[]) {
	const vaults = [...new Set(targets.map((t) => t.profile))];
	const results = await Promise.all(vaults.map(checkVault));
	return new Map(results.map((r) => [r.vault, r]));
}

export async function handleAzureCheckConnectivity(
	targets: TargetRef[],
): Promise<any[]> {
	const vaultMap = await checkVaults(targets);

	const results = [];
	for (const t of targets) {
		const v = vaultMap.get(t.profile)!;
		if (!v.ok) {
			results.push({ ...t, ok: false, stage: "vault", error: v.error });
			continue;
		}
		const s = await getSecretCached(t.profile, t.secretName);
		if (!s.ok) {
			results.push({ ...t, ok: false, stage: "secret", error: s.raw });
			continue;
		}
		results.push({ ...t, ok: true, cached: s.cached });
	}
	return results;
}

export async function handleAzureFetchAndCache(
	targets: TargetRef[],
): Promise<any[]> {
	const vaultMap = await checkVaults(targets);
	const fetched = new Map<string, { ok: boolean; error?: string }>();

	for (const t of targets) {
		const key = cacheKey(t.profile, t.secretName);
		if (!vaultMap.get(t.profile)!.ok || fetched.has(key)) {
			continue;
		}
		try {
			const raw = await fetchSecret(t.profile, t.secretName);
			secretCache.set(key, { value: raw, fetchedAt: Date.now() });
			fetched.set(key, { ok: true });
		} catch (e: any) {
			fetched.set(key, { ok: false, error: errorMessage(e) });
		}
	}

	return targets.map((t) => {
		const v = vaultMap.get(t.profile)!;
		if (!v.ok) {
			return { ...t, ok: false, stage: "vault", error: v.error };
		}
		const secret = fetched.get(cacheKey(t.profile, t.secretName))!;
		if (!secret.ok) {
			return { ...t, ok: false, stage: "secret", error: secret.error };
		}
		return { ...t, ok: true, cached: false };
	});
}

export function clearAzureSecretCache(targets: TargetRef[]): any[] {
	const cleared = new Map<string, boolean>();

	for (const t of targets) {
		const key = cacheKey(t.profile, t.secretName);
		if (!cleared.has(key)) {
			cleared.set(key, secretCache.delete(key));
		}
	}

	return targets.map((t) => ({
		...t,
		ok: true,
		cached: false,
		error: cleared.get(cacheKey(t.profile, t.secretName))
			? undefined
			: "Not cached",
	}));
}
