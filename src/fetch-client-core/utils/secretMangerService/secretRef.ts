// No SDK imports allowed here: this file is also bundled into the webview UI.
export type SecretProvider = "aws" | "azure";

export interface ParsedSecretKey {
	provider: SecretProvider;
	/** AWS profile or Azure Key Vault name. */
	scope: string;
	secretName: string;
	jsonProperty?: string;
}

const SECRET_KEY_REGEX = /^(aws|azure):([^:{}]+):([^:{}]+)(?::([^:{}]+))?$/;

export function parseSecretKey(key: string): ParsedSecretKey | null {
	const m = SECRET_KEY_REGEX.exec((key ?? "").trim());
	if (!m) {
		return null;
	}
	return {
		provider: m[1] as SecretProvider,
		scope: m[2],
		secretName: m[3],
		jsonProperty: m[4],
	};
}
