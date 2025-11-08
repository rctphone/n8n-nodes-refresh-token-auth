import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
	IDataObject,
} from 'n8n-workflow';

const CREDENTIALS_NAME = 'RefreshTokenAuth'; // <- rename if your credential has a different name

function safeParse(body: unknown) {
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

function isObject(v: unknown): v is Record<string, unknown> {
	return !!v && typeof v === 'object' && !Array.isArray(v);
}

function redactHeaders(headers: Record<string, any>) {
	const SENSITIVE = ['authorization', 'x-api-key', 'api-key', 'client-secret', 'client_secret'];
	const out: Record<string, any> = {};
	for (const [k, v] of Object.entries(headers || {})) {
		out[k] = SENSITIVE.includes(k.toLowerCase()) ? '***REDACTED***' : v;
	}
	return out;
}
function redactBodyDeep(v: any): any {
	if (!isObject(v)) return v;
	const copy = JSON.parse(JSON.stringify(v));
	const walk = (o: any) => {
		if (!o || typeof o !== 'object') return;
		for (const k of Object.keys(o)) {
			const lk = k.toLowerCase();
			if (['access_token', 'refresh_token', 'client_secret', 'id_token'].includes(lk)) {
				o[k] = '***REDACTED***';
			} else {
				walk(o[k]);
			}
		}
	};
	walk(copy);
	return copy;
}

function looksLikePreAuth(opts: any, tokenUrlFromCreds?: string) {
	const url = (opts?.url?.toString?.() ?? opts?.url ?? '').toString().toLowerCase();
	const body = opts?.json ?? opts?.form ?? opts?.body;

	if (tokenUrlFromCreds && url === tokenUrlFromCreds.toLowerCase()) return true;

	const asStr = (v: any) =>
		typeof v === 'string' ? v : Buffer.isBuffer(v) ? v.toString('utf8') : '';
	if (asStr(body).includes('grant_type=refresh_token')) return true;

	if (isObject(body) && String(body.grant_type) === 'refresh_token') return true;

	if (url.includes('/oauth') && url.includes('/token')) return true;

	return false;
}

export class RefreshToken implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'RefreshToken (Debug)',
		name: 'refreshToken',
		icon: 'file:refresh-token.svg',
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

		// Try to read token endpoint from credentials to help label preauth calls
		let tokenUrlFromCreds: string | undefined;
		try {
			const creds = (await this.getCredentials(CREDENTIALS_NAME)) as any;
			tokenUrlFromCreds =
				creds?.tokenUrl || creds?.accessTokenUrl || creds?.refreshUrl || creds?.authUrl;
		} catch {
			// ignore – optional
		}

		for (let i = 0; i < items.length; i++) {
			const url = this.getNodeParameter('url', i) as string;
			const method = this.getNodeParameter('method', i) as string;
			const qs = this.getNodeParameter('qsJson', i, {}) as IDataObject;
			const headersExtra = this.getNodeParameter('headersJson', i, {}) as Record<string, any>;
			const redact = this.getNodeParameter('redact', i, false) as boolean;
			const truncate = this.getNodeParameter('truncate', i, 10000) as number;

			const body =
				method === 'GET' ? undefined : (this.getNodeParameter('bodyJson', i, {}) as IDataObject);

			type Event = {
				stage: 'request' | 'response';
				ts: string;
				url: string;
				method?: string;
				statusCode?: number;
				headers: Record<string, any>;
				body: any;
				isPreAuth?: boolean;
			};
			const events: Event[] = [];

			// Hooks to capture every HTTP call (token exchange + main)
			const hooks = {
				beforeRequest: [
					(opts: any) => {
						events.push({
							stage: 'request',
							ts: new Date().toISOString(),
							url: (opts?.url?.toString?.() ?? opts?.url ?? '').toString(),
							method: opts?.method ?? 'GET',
							headers: { ...(opts?.headers ?? {}) },
							body: safeParse(opts?.json ?? opts?.form ?? opts?.body),
							isPreAuth: looksLikePreAuth(opts, tokenUrlFromCreds),
						});
					},
				],
				afterResponse: [
					(res: any) => {
						events.push({
							stage: 'response',
							ts: new Date().toISOString(),
							url: (res?.url ?? '').toString(),
							statusCode: res?.statusCode,
							headers: { ...(res?.headers ?? {}) },
							body: safeParse(res?.body),
						});
						return res;
					},
				],
			};

			const reqOpts: IHttpRequestOptions = {
				method: method as IHttpRequestOptions['method'],
				url,
				qs,
				json: true,
				headers: { ...headersExtra },
				body,
				// legacy compat
				// @ts-ignore
				resolveWithFullResponse: true,
				returnFullResponse: true,
				// pass hooks through n8n to the underlying HTTP client
				// @ts-ignore typings may omit hooks
				hooks,
			};

			let fullResp: any;
			try {
				fullResp = await this.helpers.httpRequestWithAuthentication.call(
					this,
					CREDENTIALS_NAME,
					reqOpts,
				);
			} catch (e: any) {
				// Even on failure, we still want to show what we captured
				const errorPayload = isObject(e) ? e : { message: String(e) };
				out.push({
					json: {
						error: errorPayload,
						events: redact
							? events.map((ev) => ({
									...ev,
									headers: redactHeaders(ev.headers),
									body:
										ev.stage === 'request'
											? ev.body // requests rarely carry tokens beyond Authorization header
											: redactBodyDeep(ev.body),
								}))
							: events,
					},
				});
				continue;
			}

			// Pair each request with its following response
			type Call = { kind: 'preauth' | 'main' | 'unknown'; request?: Event; response?: Event };
			const calls: Call[] = [];
			let pendingReq: Event | undefined;
			for (const ev of events) {
				if (ev.stage === 'request') {
					pendingReq = ev;
				} else {
					if (pendingReq) {
						const kind: Call['kind'] = pendingReq.isPreAuth
							? 'preauth'
							: calls.some((c) => c.kind === 'main')
								? 'unknown'
								: 'main';

						calls.push({ kind, request: pendingReq, response: ev });
						pendingReq = undefined;
					} else {
						calls.push({ kind: 'unknown', response: ev });
					}
				}
			}

			// Truncation helper
			const trunc = (v: any) => {
				if (truncate === 0) return v;
				const s = typeof v === 'string' ? v : JSON.stringify(v, null, 2);
				return s.length > truncate
					? s.slice(0, truncate) + `… [truncated ${s.length - truncate} chars]`
					: s;
			};

			const mapped = calls.map((c) => {
				const reqHeaders = c.request?.headers ?? {};
				const resHeaders = c.response?.headers ?? {};
				return {
					kind: c.kind,
					request: c.request
						? {
								ts: c.request.ts,
								method: c.request.method,
								url: c.request.url,
								headers: redact ? redactHeaders(reqHeaders) : reqHeaders,
								body: trunc(c.request.body),
							}
						: null,
					response: c.response
						? {
								ts: c.response.ts,
								statusCode: c.response.statusCode,
								url: c.response.url,
								headers: redact ? redactHeaders(resHeaders) : resHeaders,
								body: trunc(redact ? redactBodyDeep(c.response.body) : c.response.body),
							}
						: null,
				};
			});

			out.push({
				json: {
					summary: {
						item: i,
						mainUrl: url,
						statusCode: fullResp?.statusCode ?? null,
						totalEvents: events.length,
						totalCalls: mapped.length,
					},
					calls: mapped,
				},
			});
		}

		return [out];
	}
}
