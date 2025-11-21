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

function isObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}

function safeParseBody(body: any) {
	if (Buffer.isBuffer(body)) {
		const s = body.toString('utf8');
		try {
			return JSON.parse(s);
		} catch {
			return s;
		}
	}
	if (typeof body === 'string') {
		try {
			return JSON.parse(body);
		} catch {
			return body;
		}
	}
	return body ?? null;
}

function redactHeaders(h: Record<string, any>) {
	const SENSITIVE = ['authorization', 'x-api-key', 'api-key', 'client-secret', 'client_secret'];
	const out: Record<string, any> = {};
	for (const [k, v] of Object.entries(h || {}))
		out[k] = SENSITIVE.includes(k.toLowerCase()) ? '***REDACTED***' : v;
	return out;
}

function redactBodyDeep(v: any): any {
	if (!v || typeof v !== 'object') return v;
	const copy = JSON.parse(JSON.stringify(v));
	const walk = (o: any) => {
		if (!o || typeof o !== 'object') return;
		for (const k of Object.keys(o)) {
			const lk = k.toLowerCase();
			if (['access_token', 'refresh_token', 'client_secret', 'id_token'].includes(lk))
				o[k] = '***REDACTED***';
			else walk(o[k]);
		}
	};
	walk(copy);
	return copy;
}

function looksLikePreAuth(url: string, body: any, tokenUrlFromCreds?: string) {
	const u = (url || '').toLowerCase();
	if (tokenUrlFromCreds && u === tokenUrlFromCreds.toLowerCase()) return true;

	const asStr =
		typeof body === 'string' ? body : Buffer.isBuffer(body) ? body.toString('utf8') : '';

	if (asStr.includes('grant_type=refresh_token')) return true;
	if (isObject(body) && String((body as any).grant_type) === 'refresh_token') return true;
	if (u.includes('/oauth') && u.includes('/token')) return true;
	return false;
}

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
				options: [
					{ name: 'DELETE', value: 'DELETE' },
					{ name: 'GET', value: 'GET' },
					{ name: 'PATCH', value: 'PATCH' },
					{ name: 'POST', value: 'POST' },
					{ name: 'PUT', value: 'PUT' },
				],
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
			// Send / capture toggles
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
				default: false, // show everything by default as requested
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
		const items = this.getInputData();
		const out: INodeExecutionData[] = [];

		// Read token URL from credentials (for better pre-auth tagging)
		let tokenUrlFromCreds: string | undefined;
		try {
			const creds = (await this.getCredentials(CREDENTIALS_NAME)) as IDataObject;
			tokenUrlFromCreds =
				(creds?.tokenUrl as string) ||
				(creds?.accessTokenUrl as string) ||
				(creds?.refreshUrl as string) ||
				(creds?.authUrl as string);
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
			const truncate = this.getNodeParameter('truncate', i, 12000) as number;

			const body =
				method === 'GET' ? undefined : (this.getNodeParameter('bodyJson', i, {}) as IDataObject);

			const events: Event[] = [];

			// Create wrapper for httpRequest that captures all HTTP calls
			const originalHttpRequest = this.helpers.httpRequest.bind(this.helpers);

			const wrappedHttpRequest = async (
				requestOptions: IHttpRequestOptions,
			): Promise<IN8nHttpFullResponse | IN8nHttpResponse> => {
				// Extract URL for logging (before processing)
				let urlForCapture = String(requestOptions.url || requestOptions.baseURL || '');
				const reqBodyForCapture =
					(requestOptions as any).form ??
					(requestOptions as any).body ??
					(requestOptions as any).json ??
					undefined;

				// Detect if this is pre-auth request
				const isPre = looksLikePreAuth(urlForCapture, reqBodyForCapture, tokenUrlFromCreds);
				const shouldSend = isPre ? sendPreauth : sendMain;

				// Log request
				events.push({
					stage: 'request',
					ts: new Date().toISOString(),
					source: 'helper',
					url: urlForCapture,
					method: String(requestOptions.method || 'GET').toUpperCase(),
					headers: { ...(requestOptions.headers || {}) },
					body: safeParseBody(reqBodyForCapture),
					isPreAuth: isPre,
				});

				// If we should not send, return mock
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
						url: urlForCapture,
						statusCode: mock.statusCode,
						statusMessage: mock.statusMessage,
						headers: mock.headers,
						body: mock.body,
						isPreAuth: isPre,
					});

					if (requestOptions.returnFullResponse) {
						return mock as IN8nHttpFullResponse;
					}
					return mock.body;
				}

				// Send actual request
				const result = await originalHttpRequest(requestOptions);

				// Log response
				const responseData = (result as any).body ?? result;
				const statusCode = (result as any).statusCode ?? 200;
				const statusMessage = (result as any).statusMessage ?? 'OK';
				const responseHeaders = (result as any).headers ?? {};

				events.push({
					stage: 'response',
					ts: new Date().toISOString(),
					source: 'helper',
					url: urlForCapture,
					statusCode,
					statusMessage,
					headers: responseHeaders,
					body: safeParseBody(responseData),
					isPreAuth: isPre,
				});

				return result;
			};

			// Replace httpRequest temporarily
			(this.helpers as any).httpRequest = wrappedHttpRequest;

			// Build the MAIN request with credentials (pre-auth will flow through OUR patched invokeAxios)
			const reqOpts: IHttpRequestOptions = {
				method: method as IHttpRequestMethods,
				url,
				qs,
				headers: { ...headersExtra },
				json: true,
				body,
				returnFullResponse: true,
			};

			let mainResp: any;
			try {
				mainResp = await this.helpers.httpRequestWithAuthentication.call(
					this,
					CREDENTIALS_NAME,
					reqOpts,
				);
			} catch (err) {
				// restore httpRequest
				(this.helpers as any).httpRequest = originalHttpRequest;

				const trunc = (v: any) => {
					if (truncate === 0) return v;
					const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
					return s.length > truncate
						? s.slice(0, truncate) + `… [truncated ${s.length - truncate} chars]`
						: s;
				};

				out.push({
					json: {
						error: String((err as any)?.message || err),
						events: events.map((e) => ({
							...e,
							headers: redact ? redactHeaders(e.headers) : e.headers,
							body: trunc(e.stage === 'response' && redact ? redactBodyDeep(e.body) : e.body),
						})),
						note: 'Main request errored (often expected if sending disabled).',
					},
				});
				continue;
			} finally {
				// Always restore httpRequest
				(this.helpers as any).httpRequest = originalHttpRequest;
			}

			// Pair requests with responses into preauth/main calls
			type Call = { kind: 'preauth' | 'main'; request?: Event; response?: Event };
			const calls: Call[] = [];
			let pending: Event | undefined;

			for (const e of events) {
				if (e.stage === 'request') pending = e;
				else if (pending) {
					calls.push({
						kind: pending.isPreAuth ? 'preauth' : 'main',
						request: pending,
						response: e,
					});
					pending = undefined;
				}
			}

			const trunc = (v: any) => {
				if (truncate === 0) return v;
				const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
				return s.length > truncate
					? s.slice(0, truncate) + `… [truncated ${s.length - truncate} chars]`
					: s;
			};

			const mapped = calls.map((c) => {
				const reqH = c.request?.headers || {};
				const resH = c.response?.headers || {};
				return {
					kind: c.kind,
					request: c.request
						? {
								ts: c.request.ts,
								method: c.request.method,
								url: c.request.url,
								headers: redact ? redactHeaders(reqH) : reqH,
								body: trunc(c.request.body),
							}
						: null,
					response: c.response
						? {
								ts: c.response.ts,
								statusCode: c.response.statusCode,
								statusMessage: c.response.statusMessage,
								url: c.response.url,
								headers: redact ? redactHeaders(resH) : resH,
								body: trunc(redact ? redactBodyDeep(c.response.body) : c.response.body),
								error: c.response.error || undefined,
							}
						: null,
				};
			});

			out.push({
				json: {
					summary: {
						item: i,
						mainUrl: url,
						statusCode: mainResp?.statusCode ?? null,
						preauthCount: mapped.filter((c) => c.kind === 'preauth').length,
						mainCount: mapped.filter((c) => c.kind === 'main').length,
						sendPreauth,
						sendMain,
					},
					calls: mapped,
					// raw timeline
					events: events.map((e) => ({
						...e,
						headers: redact ? redactHeaders(e.headers) : e.headers,
						body: trunc(e.stage === 'response' && redact ? redactBodyDeep(e.body) : e.body),
					})),
				},
			});
		}

		return [out];
	}
}
