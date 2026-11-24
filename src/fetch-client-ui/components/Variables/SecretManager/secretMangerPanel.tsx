import "./style.css";
import {
	requestTypes,
	responseTypes,
} from "../../../../fetch-client-core/consts/requestTypes.consts";
import { IVariable } from "../../../../fetch-client-core/types/sidebar.types";
import {
	parseSecretKey,
	SecretProvider,
} from "../../../../fetch-client-core/utils/secretMangerService/secretRef";
import PanelLayout from "../../Common/Layout/panelLayout";
import React, { useEffect, useMemo, useState } from "react";
import vscode from "../../Common/vscodeAPI";

interface AwsKeyRef {
	variableId: string;
	variableName: string;
	provider: SecretProvider;
	/** AWS profile or Azure Key Vault name. */
	profile: string;
	secretName: string;
	jsonProperty?: string;
}

interface ResultRow extends AwsKeyRef {
	ok?: boolean;
	stage?: "profile" | "vault" | "secret";
	error?: string;
	cached?: boolean;
}

type ResultAction = "check" | "cache" | "clear";

const scopeKey = (r: AwsKeyRef) => `${r.provider}::${r.profile}`;

function extractAwsRefs(vars: IVariable[]): AwsKeyRef[] {
	const refs: AwsKeyRef[] = [];

	vars.forEach((v, index) => {
		if (index === 0) {
			return;
		}
		if (!v.isActive) {
			return;
		}

		for (const row of v.data ?? []) {
			if (row.isChecked === false) {
				continue;
			}
			const m = parseSecretKey(row.key);
			if (m) {
				refs.push({
					variableId: v.id,
					variableName: v.name,
					provider: m.provider,
					profile: m.scope,
					secretName: m.secretName,
					jsonProperty: m.jsonProperty,
				});
			}
		}
	});

	return refs;
}

const SecretMangerPanel = () => {
	const [variables, setVariables] = useState<IVariable[]>([]);
	const [loading, setLoading] = useState(true);
	const [checking, setChecking] = useState(false);
	const [caching, setCaching] = useState(false);
	const [clearing, setClearing] = useState(false);
	const [results, setResults] = useState<ResultRow[]>([]);
	const [lastAction, setLastAction] = useState<ResultAction | null>(null);
	const [selectedProfile, setSelectedProfile] = useState("all");

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			if (event.data?.type === responseTypes.getAllVariableResponse) {
				setVariables(event.data.variable as IVariable[]);
				setLoading(false);
			} else if (
				event.data?.type === responseTypes.awsCheckConnectivityResponse
			) {
				setResults(event.data.results as ResultRow[]);
				setChecking(false);
			} else if (event.data?.type === responseTypes.awsFetchAndCacheResponse) {
				setResults(event.data.results as ResultRow[]);
				setCaching(false);
			} else if (event.data?.type === responseTypes.clearSecretCacheResponse) {
				setResults(event.data.results as ResultRow[]);
				setClearing(false);
			}
		};
		window.addEventListener("message", handleMessage);
		vscode.postMessage({ type: requestTypes.getAllVariableRequest });
		return () => window.removeEventListener("message", handleMessage);
	}, []);

	const allRefs = useMemo(() => extractAwsRefs(variables), [variables]);

	// First dropdown: distinct provider/scope pairs found across all variables
	const profileOptions = useMemo(() => {
		const seen = new Map<string, string>();
		allRefs.forEach((r) =>
			seen.set(scopeKey(r), `${r.provider.toUpperCase()}: ${r.profile}`),
		);
		return Array.from(seen, ([value, label]) => ({ value, label }));
	}, [allRefs]);

	// Keys associated with the selected profile (or all, if "all" is selected)
	const associatedRefs = useMemo(() => {
		if (selectedProfile === "all") {
			return allRefs;
		}
		return allRefs.filter((r) => scopeKey(r) === selectedProfile);
	}, [allRefs, selectedProfile]);

	function onCheckClick() {
		const targets = associatedRefs;
		if (!targets.length) {
			return;
		}
		setChecking(true);
		setResults([]);
		setLastAction("check");
		vscode.postMessage({
			type: requestTypes.awsCheckConnectivityRequest,
			data: { targets },
		});
	}

	function onFetchAndCacheClick() {
		const targets = associatedRefs;
		if (!targets.length) {
			return;
		}
		setCaching(true);
		setResults([]);
		setLastAction("cache");
		vscode.postMessage({
			type: requestTypes.awsFetchAndCacheRequest,
			data: { targets },
		});
	}

	function onClearCacheClick() {
		const targets = associatedRefs;
		if (!targets.length) {
			return;
		}
		setClearing(true);
		setResults([]);
		setLastAction("clear");
		vscode.postMessage({
			type: requestTypes.clearSecretCacheRequest,
			data: { targets },
		});
	}

	function renderSelectors() {
		if (!allRefs.length) {
			return null;
		}
		return (
			<div className="aws-selectors-row">
				<span className="addto-label">Profile / Vault</span>
				<select
					className="preReq-col-select export-type-select"
					value={selectedProfile}
					onChange={(e) => setSelectedProfile(e.target.value)}
				>
					<option value="all">-- All --</option>
					{profileOptions.map((p) => (
						<option key={p.value} value={p.value}>
							{p.label}
						</option>
					))}
				</select>
			</div>
		);
	}

	function renderAssociatedKeys() {
		if (!allRefs.length) {
			return null;
		}
		if (!associatedRefs.length) {
			return (
				<div className="aws-empty-state">
					No keys found for the selected profile.
				</div>
			);
		}
		return (
			<div className="aws-results-wrapper">
				<table className="aws-results-table">
					<thead>
						<tr>
							<td>Variable</td>
							<td>Provider</td>
							<td>Profile / Vault</td>
							<td>Secret</td>
						</tr>
					</thead>
					<tbody>
						{associatedRefs.map((r, i) => (
							<tr
								key={`${r.variableId}-${r.provider}-${r.profile}-${r.secretName}-${r.jsonProperty ?? ""}-${i}`}
							>
								<td>{r.variableName}</td>
								<td>{r.provider.toUpperCase()}</td>
								<td>{r.profile}</td>
								<td>
									{r.secretName}
									{r.jsonProperty ? `.${r.jsonProperty}` : ""}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}

	function renderResults() {
		if (!results.length) {
			return null;
		}
		return (
			<div className="aws-results-wrapper">
				<table className="aws-results-table">
					<thead>
						<tr>
							<td>Variable</td>
							<td>Provider</td>
							<td>Profile / Vault</td>
							<td>Secret</td>
							<td>Status</td>
							<td>Detail</td>
						</tr>
					</thead>
					<tbody>
						{results.map((r, i) => (
							<tr key={i}>
								<td>{r.variableName}</td>
								<td>{r.provider?.toUpperCase()}</td>
								<td>{r.profile}</td>
								<td>
									{r.secretName}
									{r.jsonProperty ? `.${r.jsonProperty}` : ""}
								</td>
								<td>
									{r.ok ? (
										<span className="aws-status aws-status--ok">
											<span className="aws-status-dot aws-status-dot--ok" />
											{lastAction === "clear" ? "Cleared" : "Connected"}
										</span>
									) : (
										<span className="aws-status aws-status--fail">
											<span className="aws-status-dot aws-status-dot--fail" />
											Failed{r.stage ? ` (${r.stage})` : ""}
										</span>
									)}
								</td>
								<td className="aws-detail-cell">
									{lastAction === "clear" ? (
										r.ok ? (
											(r.error ?? "Removed from cache")
										) : (
											r.error
										)
									) : r.ok ? (
										r.cached ? (
											<span className="aws-cache-badge">cached</span>
										) : (
											"fetched"
										)
									) : (
										r.error
									)}
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		);
	}

	function renderHint() {
		if (!allRefs.length && !loading) {
			return (
				<div className="aws-empty-state">
					No variables use the {"{{aws:profile:secret:property}}"} or{" "}
					{"{{azure:vault:secret:property}}"} format yet.
				</div>
			);
		}
		return null;
	}

	function renderForm() {
		if (!allRefs.length) {
			return null;
		}
		return (
			<>
				{renderSelectors()}
				{renderAssociatedKeys()}
			</>
		);
	}

	function renderFooter() {
		if (!allRefs.length) {
			return null;
		}
		return (
			<div className="reorder-btn-panel">
				<button
					type="submit"
					className="submit-button check-btn"
					onClick={onCheckClick}
					disabled={checking || caching || clearing}
				>
					{checking ? "Checking..." : "Test Connection"}
				</button>
				<button
					type="button"
					className="submit-button check-btn"
					onClick={onFetchAndCacheClick}
					disabled={checking || caching || clearing}
				>
					{caching ? "Fetching..." : "Fetch & Cache"}
				</button>
				<button
					type="button"
					className="submit-button check-btn"
					onClick={onClearCacheClick}
					disabled={checking || caching || clearing}
				>
					{clearing ? "Clearing..." : "Clear Cache"}
				</button>
			</div>
		);
	}

	return (
		<PanelLayout
			title="🔐 Secrets Integration"
			loading={loading}
			footer={renderFooter()}
		>
			{renderHint()}
			{renderForm()}
			{renderResults()}
		</PanelLayout>
	);
};

export default SecretMangerPanel;
