import type { SecretProvider } from "./secretRef";

// Provider modules are imported lazily so their SDKs stay out of extension start-up.
interface ProviderImpl {
	getSecretCached(
		scope: string,
		secretName: string,
	): Promise<{ ok: boolean; raw: string; cached: boolean }>;
	check(targets: any[]): Promise<any[]>;
	fetchAndCache(targets: any[]): Promise<any[]>;
	clear(targets: any[]): any[];
}

export interface SecretTarget {
	variableId: string;
	variableName: string;
	provider?: SecretProvider;
	profile: string;
	secretName: string;
	jsonProperty?: string;
}

const providers = new Map<SecretProvider, Promise<ProviderImpl>>();

function loadProvider(provider: SecretProvider): Promise<ProviderImpl> {
	let impl = providers.get(provider);
	if (!impl) {
		impl =
			provider === "azure"
				? import(
						/* webpackChunkName: "secrets-azure" */ "./azureConnectivityService"
					).then((m) => ({
						getSecretCached: m.getSecretCached,
						check: m.handleAzureCheckConnectivity,
						fetchAndCache: m.handleAzureFetchAndCache,
						clear: m.clearAzureSecretCache,
					}))
				: import(
						/* webpackChunkName: "secrets-aws" */ "./awsConnectivityService"
					).then((m) => ({
						getSecretCached: m.getSecretCached,
						check: m.handleAwsCheckConnectivity,
						fetchAndCache: m.handleAwsFetchAndCache,
						clear: m.clearAwsSecretCache,
					}));
		impl.catch(() => providers.delete(provider));
		providers.set(provider, impl);
	}
	return impl;
}

export async function getSecretCached(
	provider: SecretProvider,
	scope: string,
	secretName: string,
) {
	try {
		const impl = await loadProvider(provider);
		return await impl.getSecretCached(scope, secretName);
	} catch (e: any) {
		return { ok: false, raw: e?.message ?? String(e), cached: false };
	}
}

async function runGrouped(
	targets: SecretTarget[],
	run: (impl: ProviderImpl, group: SecretTarget[]) => Promise<any[]> | any[],
): Promise<any[]> {
	const results: any[] = new Array(targets.length);
	const groups = new Map<SecretProvider, number[]>();
	targets.forEach((t, i) => {
		const p = t.provider ?? "aws";
		groups.set(p, [...(groups.get(p) ?? []), i]);
	});

	await Promise.all(
		[...groups].map(async ([provider, indexes]) => {
			const group = indexes.map((i) => targets[i]);
			let out: any[];
			try {
				out = await run(await loadProvider(provider), group);
			} catch (e: any) {
				out = group.map((t) => ({
					...t,
					provider,
					ok: false,
					error: e?.message ?? String(e),
				}));
			}
			indexes.forEach((i, k) => (results[i] = out[k]));
		}),
	);
	return results;
}

export function handleCheckConnectivity(targets: SecretTarget[]) {
	return runGrouped(targets, (impl, g) => impl.check(g));
}

export function handleFetchAndCache(targets: SecretTarget[]) {
	return runGrouped(targets, (impl, g) => impl.fetchAndCache(g));
}

export function clearSecretCache(targets: SecretTarget[]) {
	return runGrouped(targets, (impl, g) => impl.clear(g));
}
