import {
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	ICredentialDataDecryptedObject,
	IHttpRequestHelper,
	IHttpRequestOptions,
	IHttpRequestMethods,
	Icon,
	jsonParse,
	IDataObject,
	IAuthenticateGeneric,
} from 'n8n-workflow';

import jwt from 'jsonwebtoken';

const JWT_VALIDATION_ERROR = 'Access token must be a valid JWT token';

/** Get nested value from object using dot notation (e.g., "data.token") */
function getNestedValue(obj: any, path: string): any {
	if (!path || !obj) return undefined;
	return path
		.split('.')
		.reduce(
			(curr, key) => (curr && typeof curr === 'object' && key in curr ? curr[key] : undefined),
			obj,
		);
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
 * Validate JWT format and return payload as IDataObject for further processing.
 * Uses jsonwebtoken library to decode and validate JWT structure.
 */
function validateAndParseJwtPayload(token: unknown): IDataObject {
	if (typeof token !== 'string' || token.trim() === '') {
		throw new Error(JWT_VALIDATION_ERROR);
	}

	try {
		// Decode JWT without verification (we only need to read exp claim)
		const decoded = jwt.decode(token, { complete: true });

		if (!decoded || typeof decoded === 'string' || !decoded.payload) {
			throw new Error(JWT_VALIDATION_ERROR);
		}

		return decoded.payload as IDataObject;
	} catch (error) {
		throw new Error(JWT_VALIDATION_ERROR);
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

		// Build Authorization header with proper separator
		const prefix = credentials.authHeaderPrefix || 'Bearer';
		const separator = prefix === 'Bearer' ? ' ' : '';
		requestOptions.headers = { Authorization: `${prefix}${separator}${credentials.accessToken}` };

		// Apply SSL certificate validation skip if configured
		if (credentials.allowUnauthorizedCerts) {
			requestOptions.skipSslCertificateValidation = true;
		}

		// Apply common template (request fields have priority, so sourceOverrides=false)
		applyJsonTemplate(
			requestOptions,
			credentials.commonRequestTemplate as string,
			'Invalid Common Request Template JSON',
			['headers', 'qs'],
			false, // request fields override common template
		);

		return requestOptions;
	}

	/**
	 * Test the credentials by making a request to the test URL
	 * Supports SSL certificate validation skip when allowUnauthorizedCerts is true
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.testUrl}}',
			url: '',
			method: 'GET',
			skipSslCertificateValidation:
				'={{$credentials.allowUnauthorizedCerts}}' as unknown as boolean,
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
				case 'onJwtExpiry':
					try {
						const payload = validateAndParseJwtPayload(accessToken);
						const exp = payload.exp as number;
						if (!exp) return true; // No exp claim - refresh to be safe
						return exp - Math.floor(Date.now() / 1000) <= jwtExpiryLeewaySeconds;
					} catch {
						return true; // Invalid JWT - refresh to get new token
					}
				default:
					return false;
			}
		})();

		if (!shouldRefresh) return {};

		// Build refresh request
		const allowUnauthorizedCerts = credentials.allowUnauthorizedCerts as boolean;
		const requestOptions: IHttpRequestOptions = {
			url: credentials.refreshUrl as string,
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			skipSslCertificateValidation: allowUnauthorizedCerts,
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

		if (auth.method) requestOptions.method = auth.method as IHttpRequestMethods;
		mergeObjectFields(requestOptions, auth, ['headers', 'body', 'qs']);

		// 3) Execute refresh request and extract tokens
		try {
			const response = await this.helpers.httpRequest(requestOptions);
			const accessTokenField = (credentials.accessTokenFieldName as string) || 'access_token';
			const refreshTokenField = (credentials.refreshTokenFieldName as string) || 'refresh_token';

			const newAccessToken = getNestedValue(response, accessTokenField);
			if (!newAccessToken) throw new Error('Access token not found in response');

			validateAndParseJwtPayload(newAccessToken); // Validate JWT format

			return {
				accessToken: newAccessToken,
				refreshToken: getNestedValue(response, refreshTokenField) || credentials.refreshToken,
				hidden: '', //please keep it as empty to always run preAuth again
			};
		} catch (error: any) {
			throw new Error(`Token refresh failed: ${error.message}`);
		}
	}
}
