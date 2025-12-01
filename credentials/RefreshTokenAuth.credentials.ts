import {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	ICredentialDataDecryptedObject,
	IHttpRequestHelper,
	IHttpRequestOptions,
	Icon,
	jsonParse,
	IDataObject,
	IAuthenticateGeneric,
} from 'n8n-workflow';

import jwt from 'jsonwebtoken';

/**
 * Get nested value from object using dot notation (e.g., "data.token")
 * Also searches in common wrapper paths (body., data., response.) if direct path not found
 */
function getNestedValue(obj: any, path: string): any {
	if (!path || !obj) return undefined;

	// Helper to traverse object by dot-notation path
	const traverse = (target: any, keys: string[]): any =>
		keys.reduce(
			(curr, key) => (curr && typeof curr === 'object' && key in curr ? curr[key] : undefined),
			target,
		);

	const keys = path.split('.');

	// 1) Try exact path first
	const directValue = traverse(obj, keys);
	if (directValue !== undefined) return directValue;

	// 2) Try common wrapper prefixes if direct path not found
	const commonPrefixes = ['body', 'data', 'response'];
	for (const prefix of commonPrefixes) {
		if (obj[prefix] && typeof obj[prefix] === 'object') {
			const prefixedValue = traverse(obj[prefix], keys);
			if (prefixedValue !== undefined) return prefixedValue;
		}
	}

	return undefined;
}

/** Replace {{$credentials.accessToken}} and {{$credentials.refreshToken}} placeholders */
function replacePlaceholders(value: any, credentials: ICredentialDataDecryptedObject): any {
	if (typeof value !== 'string') return value;
	return value
		.replace(/\{\{\$credentials\.accessToken\}\}/g, (credentials.accessToken as string) || '')
		.replace(/\{\{\$credentials\.refreshToken\}\}/g, (credentials.refreshToken as string) || '');
}

/** Recursively replace credential placeholders in an object */
function replacePlaceholdersInObject(obj: any, credentials: ICredentialDataDecryptedObject): any {
	if (typeof obj !== 'object' || obj === null) return replacePlaceholders(obj, credentials);
	if (Array.isArray(obj)) return obj.map((item) => replacePlaceholdersInObject(item, credentials));
	return Object.fromEntries(
		Object.entries(obj).map(([key, val]) => [key, replacePlaceholdersInObject(val, credentials)]),
	);
}

/** Merge object fields from source into target (source values override target) */
function mergeObjectFields(
	target: IHttpRequestOptions,
	source: IDataObject,
	fields: readonly string[],
	sourceOverrides = true,
): void {
	for (const field of fields) {
		if (source[field]) {
			const targetObj = target as Record<string, any>;
			const [first, second] = sourceOverrides
				? [targetObj[field], source[field]]
				: [source[field], targetObj[field]];
			targetObj[field] = { ...(first as IDataObject), ...(second as IDataObject) };
		}
	}
}

/** Safely parse JSON template and merge into request options */
function applyJsonTemplate(
	requestOptions: IHttpRequestOptions,
	jsonString: string | undefined,
	errorMessage: string,
	fields: readonly string[],
	sourceOverrides = true,
): void {
	if (!jsonString) return;
	try {
		const template = jsonParse<IDataObject>(jsonString, { errorMessage });
		mergeObjectFields(requestOptions, template, fields, sourceOverrides);
	} catch {
		// Ignore parse errors
	}
}

/**
 * Try to parse JWT and return payload as IDataObject.
 * Returns null if token is not a valid JWT (non-JWT tokens are allowed).
 * Uses jsonwebtoken library to decode JWT structure.
 */
function tryParseJwtPayload(token: unknown): IDataObject | null {
	if (typeof token !== 'string' || token.trim() === '') {
		return null;
	}

	try {
		// Decode JWT without verification (we only need to read exp claim)
		const decoded = jwt.decode(token, { complete: true });

		if (!decoded || typeof decoded === 'string' || !decoded.payload) {
			return null; // Not a valid JWT, but that's okay
		}

		return decoded.payload as IDataObject;
	} catch {
		return null; // Not a JWT token
	}
}

// eslint-disable-next-line n8n-nodes-base/cred-class-field-display-name-missing-api, n8n-nodes-base/cred-class-name-unsuffixed
export class RefreshTokenAuth implements ICredentialType {
	/**
	 * Static reference to the class instance.
	 *
	 * WHY WE NEED THIS PATTERN:
	 * 1. n8n requires `authenticate` property to be IAuthenticateGeneric for credentials
	 *    to appear in "Predefined Credential Type" dropdown in HTTP Request node.
	 * 2. However, IAuthenticateGeneric is a static object with fixed expressions,
	 *    which doesn't support our dynamic authentication logic (commonRequestTemplate, etc.)
	 * 3. n8n's httpRequest helper ignores custom credential types for generic auth -
	 *    it only processes predefined credential types from nodes-base.
	 *
	 * SOLUTION:
	 * - Declare `authenticate` as IAuthenticateGeneric to satisfy n8n's type requirements
	 * - Store class instance in static variable via constructor
	 * - In preAuthentication, replace `authenticate` with `authenticateFunc` dynamically
	 * - This allows credentials to appear in dropdown AND use dynamic authentication
	 */
	private static instance: RefreshTokenAuth;

	constructor() {
		// Store instance reference for later use in enableAuthenticateFunc
		RefreshTokenAuth.instance = this;
	}

	/**
	 * Replace static IAuthenticateGeneric with dynamic authenticateFunc.
	 * Called from preAuthentication before each request, or from unit tests.
	 *
	 * This enables:
	 * - Dynamic Authorization header with configurable prefix and separator
	 * - Application of commonRequestTemplate to all requests
	 */
	static enableAuthenticateFunc(): void {
		const credentialType = RefreshTokenAuth.instance as any;
		credentialType.authenticate = credentialType.authenticateFunc;
	}

	// eslint-disable-next-line n8n-nodes-base/cred-class-field-name-unsuffixed
	name = 'refreshTokenAuth';
	// extends = ['httpCustomAuth'];
	// eslint-disable-next-line n8n-nodes-base/cred-class-field-display-name-missing-api
	displayName = 'Refresh Token Auth';
	// genericAuth = true;
	icon: Icon = 'node:n8n-nodes-base.httpRequest';
	documentationUrl = 'https://github.com/rctphone/n8n-nodes-refresh-token-auth';
	properties: INodeProperties[] = [
		{
			displayName: 'Access Token',
			name: 'accessToken',
			type: 'string',
			typeOptions: { expirable: true, password: true },
			default: '',
			placeholder: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
			description: 'Current access token (Bearer token) used for API authentication',
		},
		{
			displayName: 'Refresh Token Mode',
			name: 'refreshTokenMode',
			type: 'options',
			default: 'onJwtExpiry',
			description: 'When to trigger token refresh',
			options: [
				{
					name: 'Never (Manual Only)',
					value: 'never',
					description: 'Do not refresh token automatically',
				},
				{
					name: 'Always',
					value: 'always',
					description: 'Always refresh token before each request',
				},
				{
					name: 'On JWT Expiry',
					value: 'onJwtExpiry',
					description: 'Refresh token when JWT exp claim indicates expiration',
				},
				{
					name: 'On 401 Error',
					value: 'onTestEndpoint401',
					description: 'Refresh token when API returns 401 Unauthorized',
				},
			],
		},
		{
			displayName: 'Refresh Token',
			name: 'refreshToken',
			type: 'string',
			required: true,
			typeOptions: { password: true },
			default: '',
			placeholder: 'Enter your refresh token',
			description: 'Token used to obtain a new access token when it expires',
		},
		{
			displayName: 'Refresh Token URL',
			name: 'refreshUrl',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'https://api.example.com/auth/refresh',
			description: 'API endpoint URL to refresh the access token',
		},
		{
			displayName: 'Test URL',
			name: 'testUrl',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'https://api.example.com/user/profile',
			description: 'API endpoint URL to test the token validity (should return HTTP 200)',
		},
		{
			displayName: 'Access Token Field Name',
			name: 'accessTokenFieldName',
			type: 'string',
			// eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
			typeOptions: { password: false },
			default: 'access_token',
			description:
				'Field name in the refresh response that contains the new access token (supports dot notation, e.g., "data.token")',
		},
		{
			displayName: 'Refresh Token Field Name',
			name: 'refreshTokenFieldName',
			type: 'string',
			// eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
			typeOptions: { password: false },
			default: 'refresh_token',
			description:
				'Field name for refresh token (used in both API request and response, supports dot notation such as "data.refreshToken")',
		},
		{
			displayName: 'Authorization Header Prefix',
			name: 'authHeaderPrefix',
			type: 'string',
			default: 'Bearer',
			description: 'Prefix for the Authorization header (e.g., "Bearer", "Token")',
		},
		{
			displayName: 'Refresh Request Configuration',
			name: 'refreshRequestJson',
			type: 'json',
			required: false,
			description: 'JSON configuration for refresh token request',
			placeholder: `{"headers": {...}, "body": {...}, "qs": {...}}`,
			default: '',
		},
		{
			displayName: `JSON configuration for refresh token request<br />
<br />
Supported placeholders:<br />
• {{$credentials.accessToken}}<br />
• {{$credentials.refreshToken}}<br />
<br />
Example:<br />
<pre>{
  "headers": { "User-Agent": "MyApp/1.0" },
  "body": {
    "grant_type": "refresh_token",
    "refresh_token": "{{$credentials.refreshToken}}",
    "client_id": "your_id",
    "client_secret": "your_secret"
  },
  "qs": {}
}</pre>`,
			name: 'refreshRequestJsonNotice',
			type: 'notice',
			default: '',
		},
		{
			displayName: 'Common Request Template',
			name: 'commonRequestTemplate',
			type: 'json',
			required: false,
			description:
				'JSON template for headers and query parameters applied to ALL requests (refresh, test, main)',
			placeholder: `{"headers": {...}, "qs": {...}}`,
			default: '',
		},
		{
			displayName: `JSON template for headers and query parameters applied to ALL requests (refresh, test, main)<br />
<br />Supported placeholders:<br />
• {{$credentials.accessToken}}<br />
• {{$credentials.refreshToken}}<br />
<br />
Example:<br />
<pre>{
  "headers": {
    "User-Agent": "MyApp/1.0",
    "X-Device-Id": "device123"
  },
  "qs": { "version": "v1" }
}</pre>`,
			name: 'commonRequestTemplateNotice',
			type: 'notice',
			default: '',
		},

		{
			displayName: 'JWT Expiry Leeway (seconds)',
			name: 'jwtExpiryLeewaySeconds',
			type: 'number',
			default: 60,
			description:
				'Number of seconds before JWT expiration to trigger refresh (only used with "On JWT Expiry" mode)',
			displayOptions: {
				show: {
					refreshTokenMode: ['onJwtExpiry'],
				},
			},
		},
		{
			displayName: 'Ignore SSL Issues (Insecure)',
			name: 'allowUnauthorizedCerts',
			type: 'boolean',
			default: false,
			// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-ignore-ssl-issues
			description:
				'Whether to skip SSL certificate validation for refresh and test requests (use with caution)',
		},
		{
			displayName: 'Hidden Field for Refreshing Logics',
			name: 'hidden',
			type: 'hidden',
			typeOptions: { expirable: true },
			default: '',
			placeholder: '',
			description:
				'Hidden field needed for refreshing logics, preAuth should return empty string to run again, do not remove!!!',
		},
	];

	/**
	 * Static authenticate configuration using generic type with Authorization header
	 * Separator logic: Bearer uses space, other prefixes use no separator
	 */
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization: '={{$credentials.authHeaderPrefix}} {{$credentials.accessToken}}',
			},
		},
	};

	/**
	 * Authenticate requests by adding Bearer token to Authorization header
	 * Also applies common request template (headers and query params) to all requests
	 * Supports SSL certificate validation skip when allowUnauthorizedCerts is true
	 */
	async authenticateFunc(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		//LoggerProxy.debug('🔥🔥🔥 RefreshTokenAuth.authenticateFunc CALLED! 🔥🔥🔥');

		// 1) Apply common template first (base headers and query params)
		applyJsonTemplate(
			requestOptions,
			credentials.commonRequestTemplate as string,
			'Invalid Common Request Template JSON',
			['headers', 'qs'],
			false, // request fields override common template
		);

		// 2) Build and apply Authorization header (overrides common template if set there)
		const prefix = credentials.authHeaderPrefix || 'Bearer';
		const separator = prefix === 'Bearer' ? ' ' : '';
		requestOptions.headers = {
			...requestOptions.headers,
			Authorization: `${prefix}${separator}${credentials.accessToken}`,
		};

		// 3) Apply SSL certificate validation skip if configured
		// Note: n8n checks skipSslCertificateValidation === true (strict equality)
		const allowUnauthorizedCerts =
			credentials.allowUnauthorizedCerts === true || credentials.allowUnauthorizedCerts === 'true';
		if (allowUnauthorizedCerts) {
			requestOptions.skipSslCertificateValidation = true;
		}

		return requestOptions;
	}

	/**
	 * Test the credentials by making a request to the test URL
	 * Supports SSL certificate validation skip when allowUnauthorizedCerts is true
	 * Note: Using url instead of baseURL+empty url because n8n's buildTargetUrl
	 * returns undefined for empty url, which prevents httpsAgent from being set
	 */
	test: ICredentialTestRequest = {
		request: {
			url: '={{$credentials.testUrl}}',
			method: 'GET',
			skipSslCertificateValidation: '={{$credentials.allowUnauthorizedCerts}}',
		},
	};

	/**
	 * Called before authentication to ensure token is valid
	 * Checks refresh mode and refreshes token if needed
	 */
	async preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject) {
		//LoggerProxy.debug('🔥🔥🔥 RefreshTokenAuth.preAuthentication CALLED! 🔥🔥🔥');

		// Enable dynamic authenticate function
		RefreshTokenAuth.enableAuthenticateFunc();

		const accessToken = credentials.accessToken as string;
		const refreshTokenMode = (credentials.refreshTokenMode as string) || 'onJwtExpiry';
		const jwtExpiryLeewaySeconds = (credentials.jwtExpiryLeewaySeconds as number) || 60;

		// Determine if refresh is needed based on mode
		const shouldRefresh = (() => {
			switch (refreshTokenMode) {
				case 'never':
				case 'onTestEndpoint401':
					return false; // Handled elsewhere or disabled
				case 'always':
					return true;
				case 'onJwtExpiry': {
					const payload = tryParseJwtPayload(accessToken);
					if (!payload) return true; // Not a JWT or invalid - refresh to be safe
					const exp = payload.exp as number;
					if (!exp) return true; // No exp claim - refresh to be safe
					return exp - Math.floor(Date.now() / 1000) <= jwtExpiryLeewaySeconds;
				}
				default:
					return false;
			}
		})();

		if (!shouldRefresh) return {};

		// Build refresh request
		// Note: n8n checks skipSslCertificateValidation === true (strict equality)
		// so we must ensure it's exactly boolean true, not string "true" or undefined
		const allowUnauthorizedCerts =
			credentials.allowUnauthorizedCerts === true || credentials.allowUnauthorizedCerts === 'true';
		const requestOptions: IHttpRequestOptions = {
			url: credentials.refreshUrl as string,
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			skipSslCertificateValidation: allowUnauthorizedCerts === true ? true : undefined,
		};

		// 1) Apply common request template
		applyJsonTemplate(
			requestOptions,
			credentials.commonRequestTemplate as string,
			'Invalid Common Request Template JSON',
			['headers', 'qs'],
		);

		// 2) Parse and apply refresh request config (overrides common template)
		const auth = replacePlaceholdersInObject(
			jsonParse<IDataObject>((credentials.refreshRequestJson as string) || '{}', {
				errorMessage: 'Invalid Refresh Request Configuration JSON',
			}),
			credentials,
		) as IDataObject;

		// Copy all simple fields from auth to requestOptions (proxy, returnFullResponse, timeout, etc.)
		const objectFieldsToMerge = ['headers', 'body', 'qs'];
		for (const key of Object.keys(auth)) {
			if (!objectFieldsToMerge.includes(key)) {
				(requestOptions as unknown as IDataObject)[key] = auth[key];
			}
		}
		// Deep merge object fields (headers, body, qs)
		mergeObjectFields(requestOptions, auth, objectFieldsToMerge);

		// 3) Execute refresh request and extract tokens
		try {
			const response = await this.helpers.httpRequest(requestOptions);
			const accessTokenField = (credentials.accessTokenFieldName as string) || 'access_token';
			const refreshTokenField = (credentials.refreshTokenFieldName as string) || 'refresh_token';

			const newAccessToken = getNestedValue(response, accessTokenField);
			if (!newAccessToken) throw new Error('Access token not found in response');

			return {
				accessToken: newAccessToken,
				refreshToken: getNestedValue(response, refreshTokenField) || credentials.refreshToken,
				hidden: '', //please keep it as empty to always run preAuth again
			};
		} catch (error: any) {
			// Build detailed error message with request and response info
			const errorLines: string[] = [`Token refresh failed: ${error.message}`];

			// Extract request info from Axios config (cleaner than http.ClientRequest)
			const axiosConfig = error.config;
			const method = axiosConfig?.method?.toUpperCase() || requestOptions.method;
			const url = error.request?._redirectable?._currentUrl || axiosConfig?.url;
			errorLines.push(`Request: ${method} ${url}`);

			// Add request headers from Axios config (mask sensitive data)
			const configHeaders = axiosConfig?.headers;
			if (configHeaders) {
				const headers = { ...configHeaders };
				// Mask sensitive headers
				if (headers.Authorization) headers.Authorization = '[MASKED]';
				if (headers.authorization) headers.authorization = '[MASKED]';
				errorLines.push(`Request headers: ${JSON.stringify(headers)}`);
			}

			// Add response info if available
			if (error.response) {
				const status = error.response.status || error.response.statusCode;
				const statusText = error.response.statusText || error.response.statusMessage || '';
				errorLines.push(`Response: ${status} ${statusText}`);

				// Add response body (truncated if too long)
				const responseBody = error.response.body || error.response.data;
				if (responseBody) {
					const bodyStr =
						typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
					const truncatedBody = bodyStr.length > 500 ? bodyStr.substring(0, 500) + '...' : bodyStr;
					errorLines.push(`Response body: ${truncatedBody}`);
				}
			}

			// Add error code if available (e.g., CERT_HAS_EXPIRED, ECONNREFUSED)
			if (error.code) {
				errorLines.push(`Error code: ${error.code}`);
			}

			throw new Error(errorLines.join(' | '));
		}
	}
}
