/** An error whose message is safe and useful to show the person using the app. */
export class HttpError extends Error {
	constructor(
		public readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "HttpError";
	}
}

export type LlmErrorKind =
	| "config"
	| "auth"
	| "billing"
	| "rate_limit"
	| "not_found"
	| "bad_request"
	| "refusal"
	| "truncated"
	| "invalid_output"
	| "connection"
	| "server"
	| "aborted";

/** A model-provider failure, translated into something actionable. */
export class LlmError extends Error {
	constructor(
		message: string,
		public readonly kind: LlmErrorKind,
	) {
		super(message);
		this.name = "LlmError";
	}

	get status(): number {
		switch (this.kind) {
			case "config":
				return 400;
			case "aborted":
				return 499;
			case "rate_limit":
				return 429;
			default:
				return 502;
		}
	}
}

export function errorMessage(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}
