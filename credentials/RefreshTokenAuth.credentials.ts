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
	// eslint-disable-next-line n8n-nodes-base/cred-class-field-name-unsuffixed
	name = 'refreshTokenAuth';
	// extends = ['oAuth2Api'];
	// eslint-disable-next-line n8n-nodes-base/cred-class-field-display-name-missing-api
	displayName = 'Refresh Token Auth';
	genericAuth = true;
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
			description: `JSON configuration for refresh token request.

Supported placeholders:
• {{$credentials.accessToken}}
• {{$credentials.refreshToken}}

Example:
{
  "headers": { "User-Agent": "MyApp/1.0" },
  "body": {
    "grant_type": "refresh_token",
    "refresh_token": "{{$credentials.refreshToken}}",
    "client_id": "your_id",
    "client_secret": "your_secret"
  },
  "qs": {}
}`,
			placeholder: `{"headers": {...}, "body": {...}, "qs": {...}}`,
			default: '',
		},
		{
			displayName: 'Common Request Template',
			name: 'commonRequestTemplate',
			type: 'json',
			required: false,
			description: `JSON template for headers and query parameters applied to ALL requests (refresh, test, main).

Supported placeholders:
• {{$credentials.accessToken}}
• {{$credentials.refreshToken}}

Example:
{
  "headers": {
    "User-Agent": "MyApp/1.0",
    "X-Device-Id": "device123"
  },
  "qs": { "version": "v1" }
}`,
			placeholder: `{"headers": {...}, "qs": {...}}`,
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
	 * Authenticate requests by adding Bearer token to Authorization header
	 * Also applies common request template (headers and query params) to all requests
	 */
	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		//LoggerProxy.debug('🔥🔥🔥 RefreshTokenAuth.authenticate CALLED! 🔥🔥🔥');

		// Build Authorization header with proper separator
		const prefix = credentials.authHeaderPrefix || 'Bearer';
		const separator = prefix === 'Bearer' ? ' ' : '';
		requestOptions.headers = { Authorization: `${prefix}${separator}${credentials.accessToken}` };

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
	 */
	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{$credentials.testUrl}}',
			url: '',
			method: 'GET',
		},
	};

	/**
	 * Called before authentication to ensure token is valid
	 * Checks refresh mode and refreshes token if needed
	 */
	async preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject) {
		//LoggerProxy.debug('🔥🔥🔥 RefreshTokenAuth.preAuthentication CALLED! 🔥🔥🔥');

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
		const requestOptions: IHttpRequestOptions = {
			url: credentials.refreshUrl as string,
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
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
