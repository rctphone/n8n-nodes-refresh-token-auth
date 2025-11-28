import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
	IDataObject,
	IHttpRequestMethods,
	IN8nHttpFullResponse,
	IN8nHttpResponse,
} from 'n8n-workflow';

const CREDENTIALS_NAME = 'refreshTokenAuth';
const SENSITIVE_HEADERS = [
	'authorization',
	'x-api-key',
	'api-key',
	'client-secret',
	'client_secret',
];
const SENSITIVE_BODY_KEYS = ['access_token', 'refresh_token', 'client_secret', 'id_token'];

type Event = {
	stage: 'request' | 'response';
	ts: string;
	url: string;
	method?: string;
	statusCode?: number;
	statusMessage?: string;
	headers: Record<string, any>;
	body: any;
	isPreAuth?: boolean;
	error?: string;
	source: 'helper';
};

// --- Helper functions ---

const isObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === 'object' && !Array.isArray(v);

/** Parse body from Buffer/string to object if possible */
function safeParseBody(body: any): any {
	if (Buffer.isBuffer(body)) body = body.toString('utf8');
	if (typeof body === 'string') {
		try {
			return JSON.parse(body);
		} catch {
			return body;
		}
	}
	return body ?? null;
}

/** Mask sensitive headers */
function redactHeaders(h: Record<string, any>): Record<string, any> {
	const out: Record<string, any> = {};
	for (const [k, v] of Object.entries(h || {})) {
		out[k] = SENSITIVE_HEADERS.includes(k.toLowerCase()) ? '***REDACTED***' : v;
	}
	return out;
}

/** Deep-walk object and mask sensitive token fields */
function redactBodyDeep(v: any): any {
	if (!v || typeof v !== 'object') return v;
	const copy = JSON.parse(JSON.stringify(v));
	const walk = (o: any) => {
		if (!o || typeof o !== 'object') return;
		for (const k of Object.keys(o)) {
			if (SENSITIVE_BODY_KEYS.includes(k.toLowerCase())) o[k] = '***REDACTED***';
			else walk(o[k]);
		}
	};
	walk(copy);
	return copy;
}

/** Detect if request looks like a pre-auth (token refresh) call */
function looksLikePreAuth(url: string, body: any, tokenUrlFromCreds?: string): boolean {
	const u = (url || '').toLowerCase();
	if (tokenUrlFromCreds && u === tokenUrlFromCreds.toLowerCase()) return true;

	const asStr =
		typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : '';
	if (asStr.includes('grant_type=refresh_token')) return true;
	if (isObject(body) && String((body as any).grant_type) === 'refresh_token') return true;
	if (u.includes('/oauth') && u.includes('/token')) return true;
	return false;
}

/** Truncate string/object to maxLen chars. Keeps objects as objects if no truncation needed. */
function truncate(v: any, maxLen: number): any {
	if (maxLen === 0) return v;
	const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
	if (s.length > maxLen) {
		return s.slice(0, maxLen) + `… [truncated ${s.length - maxLen} chars]`;
	}
	// No truncation needed - return original value to preserve objects
	return v;
}

/** Format event for output (apply redact & truncate) */
function formatEvent(e: Event, redact: boolean, truncLen: number): Event {
	return {
		...e,
		headers: redact ? redactHeaders(e.headers) : e.headers,
		body: truncate(e.stage === 'response' && redact ? redactBodyDeep(e.body) : e.body, truncLen),
	};
}

// --- Node definition ---

export class RefreshToken implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'RefreshToken (Debug)',
		name: 'refreshToken',
		icon: 'file:refresh-token-auth.svg',
		group: ['transform'],
		version: 1,
		description:
			'Runs an authenticated request with RefreshToken credentials and captures BOTH the token refresh and the main call (headers + bodies).',
		defaults: { name: 'RefreshToken (Debug)' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: CREDENTIALS_NAME, required: true }],
		properties: [
			{
				displayName: 'URL',
				name: 'url',
				type: 'string',
				default: '',
				required: true,
				placeholder: 'https://api.example.com/v1/resource',
			},
			{
				displayName: 'Method',
				name: 'method',
				type: 'options',
				default: 'GET',
				options: ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'].map((m) => ({ name: m, value: m })),
			},
			{
				displayName: 'Query (JSON)',
				name: 'qsJson',
				type: 'json',
				default: '{}',
				description: 'Merged into query string of the main request',
			},
			{
				displayName: 'Headers (JSON)',
				name: 'headersJson',
				type: 'json',
				default: '{}',
				description: 'Extra headers for the main request',
			},
			{
				displayName: 'Body (JSON)',
				name: 'bodyJson',
				type: 'json',
				default: '{}',
				description: 'Used for POST/PUT/PATCH/DELETE when sending JSON',
				displayOptions: { show: { method: ['POST', 'PUT', 'PATCH', 'DELETE'] } },
			},
			{
				displayName: 'Send Pre-Authentication',
				name: 'sendPreauth',
				type: 'boolean',
				default: true,
				description:
					'Whether to send pre-auth requests. If off, pre-auth requests are captured but NOT sent (mocked response).',
			},
			{
				displayName: 'Send Main Request',
				name: 'sendMain',
				type: 'boolean',
				default: true,
				description:
					'Whether to send main request. If off, main request is captured but NOT sent (mocked response).',
			},
			{
				displayName: 'Redact Secrets in Output',
				name: 'redact',
				type: 'boolean',
				default: false,
				description: 'Whether to mask Authorization, tokens, and client_secret',
			},
			{
				displayName: 'Truncate Bodies To (Chars)',
				name: 'truncate',
				type: 'number',
				typeOptions: { minValue: 0 },
				default: 10000,
				description: '0 = no truncation',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		this.logger.debug('🔥🔥🔥 RefreshToken.execute CALLED! 🔥🔥🔥');

		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		// Read token URL from credentials (for better pre-auth tagging)
		let tokenUrlFromCreds: string | undefined;
		try {
			const creds = (await this.getCredentials(CREDENTIALS_NAME)) as IDataObject;
			tokenUrlFromCreds = (creds?.tokenUrl ??
				creds?.accessTokenUrl ??
				creds?.refreshUrl ??
				creds?.authUrl) as string | undefined;
		} catch {
			/* optional */
		}

		for (let i = 0; i < items.length; i++) {
			const url = this.getNodeParameter('url', i) as string;
			const method = this.getNodeParameter('method', i) as string;
			const qs = this.getNodeParameter('qsJson', i, {}) as IDataObject;
			const headersExtra = this.getNodeParameter('headersJson', i, {}) as IDataObject;
			const sendPreauth = this.getNodeParameter('sendPreauth', i, true) as boolean;
			const sendMain = this.getNodeParameter('sendMain', i, true) as boolean;
			const redact = this.getNodeParameter('redact', i, false) as boolean;
			const truncLen = this.getNodeParameter('truncate', i, 12000) as number;
			const body =
				method === 'GET' ? undefined : (this.getNodeParameter('bodyJson', i, {}) as IDataObject);

			const events: Event[] = [];
			const originalHttpRequest = this.helpers.httpRequest.bind(this.helpers);

			// Wrapper to capture all HTTP calls
			const wrappedHttpRequest = async (
				opts: IHttpRequestOptions,
			): Promise<IN8nHttpFullResponse | IN8nHttpResponse> => {
				const reqUrl = String(opts.url || opts.baseURL || '');
				const reqBody = (opts as any).form ?? (opts as any).body ?? (opts as any).json;
				const isPre = looksLikePreAuth(reqUrl, reqBody, tokenUrlFromCreds);
				const shouldSend = isPre ? sendPreauth : sendMain;

				// Log request
				events.push({
					stage: 'request',
					ts: new Date().toISOString(),
					source: 'helper',
					url: reqUrl,
					method: String(opts.method || 'GET').toUpperCase(),
					headers: { ...(opts.headers || {}) },
					body: safeParseBody(reqBody),
					isPreAuth: isPre,
				});

				// Mock if not sending
				if (!shouldSend) {
					const mock = {
						body: { mocked: true, sent: false, reason: 'SKIPPED_BY_NODE' },
						headers: {},
						statusCode: 0,
						statusMessage: 'MOCKED-NOT-SENT',
					};
					events.push({
						stage: 'response',
						ts: new Date().toISOString(),
						source: 'helper',
						url: reqUrl,
						statusCode: 0,
						statusMessage: 'MOCKED-NOT-SENT',
						headers: {},
						body: mock.body,
						isPreAuth: isPre,
					});
					return opts.returnFullResponse ? (mock as IN8nHttpFullResponse) : mock.body;
				}

				// Send actual request
				const result = await originalHttpRequest(opts);
				const respBody = (result as any).body ?? result;
				events.push({
					stage: 'response',
					ts: new Date().toISOString(),
					source: 'helper',
					url: reqUrl,
					statusCode: (result as any).statusCode ?? 200,
					statusMessage: (result as any).statusMessage ?? 'OK',
					headers: (result as any).headers ?? {},
					body: safeParseBody(respBody),
					isPreAuth: isPre,
				});
				return result;
			};

			// Patch httpRequest temporarily
			(this.helpers as any).httpRequest = wrappedHttpRequest;

			const reqOpts: IHttpRequestOptions = {
				method: method as IHttpRequestMethods,
				url,
				qs,
				headers: { ...headersExtra },
				json: true,
				body,
				returnFullResponse: true,
			};

			try {
				await this.helpers.httpRequestWithAuthentication.call(this, CREDENTIALS_NAME, reqOpts);
			} catch (err) {
				out.push({
					json: {
						error: String((err as any)?.message || err),
						events: events.map((e) => formatEvent(e, redact, truncLen)),
						note: 'Main request errored (often expected if sending disabled).',
					},
				});
				continue;
			} finally {
				(this.helpers as any).httpRequest = originalHttpRequest;
			}

			out.push({ json: { events: events.map((e) => formatEvent(e, redact, truncLen)) } });
		}

		return [out];
	}
}
