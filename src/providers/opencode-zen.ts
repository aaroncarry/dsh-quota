/** OpenCode Go Zen usage adapter. */

import { asRecord, parseTimestamp, toNumber } from "../parse.ts";
import type { AccountBalance, ProviderAdapter, ProviderFetchArgs, UsageWindow } from "../types.ts";

const ENDPOINT = "https://opencode.ai/zen/go/v1/usage";
const WINDOWS = ["rolling", "weekly", "monthly"] as const;
export const opencodeZenAdapter: ProviderAdapter = {
	id: "opencode-go",
	label: "OpenCode Go",
	kind: "subscription",
	async fetch({ token, signal, fetchImpl }: ProviderFetchArgs): Promise<AccountBalance> {
		const response = await fetchImpl(ENDPOINT, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal });
		if (!response.ok) throw new Error(`OpenCode Go usage API returned HTTP ${response.status}`);
		const root = asRecord(await response.json());
		const usage = asRecord(root?.usage);
		if (!usage) throw new Error("OpenCode Go usage API returned no usage object");
		const windows: UsageWindow[] = [];
		for (const key of WINDOWS) {
			const row = asRecord(usage[key]);
			if (!row || (row.status !== "ok" && row.status !== "rate-limited")) continue;
			const percent = toNumber(row.percent);
			if (percent === undefined || percent < 0) continue;
			windows.push({ label: key, usedPercent: Math.min(100, percent), resetsAt: parseTimestamp(row.resetsAt) });
		}
		if (windows.length === 0) throw new Error("OpenCode Go usage API returned no usable windows");
		return { providerId: "opencode-go", label: "OpenCode Go", windows, notes: [], fetchedAt: Date.now() };
	},
};
