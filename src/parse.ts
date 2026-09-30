/** Shared response-field parsing helpers for provider adapters. */

/** Accept numbers or numeric strings ("0.00" style). */
export function toNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
	return undefined;
}

/** Narrow to a plain JSON object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Same as {@link isRecord} but returns the object, for optional-chaining call sites. */
export function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

/**
 * Normalize timestamps across providers: epoch seconds, epoch milliseconds
 * (numbers or numeric strings), or ISO-8601 strings. Returns epoch
 * milliseconds, or undefined.
 */
export function parseTimestamp(value: unknown): number | undefined {
	const numeric = toNumber(value);
	if (numeric !== undefined) return numeric < 1e12 ? numeric * 1000 : numeric;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Date.parse(value);
		if (!Number.isNaN(parsed)) return parsed;
	}
	return undefined;
}

/** Clamp a percentage into [0, 100]. */
export function clampPercent(value: number): number {
	return Math.max(0, Math.min(100, value));
}
