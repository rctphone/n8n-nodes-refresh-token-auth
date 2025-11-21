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
} from 'n8n-workflow';

import jwt from 'jsonwebtoken';

const JWT_VALIDATION_ERROR = 'Access token must be a valid JWT token';

/**
 * Get nested value from object using dot notation path (e.g., "data.token" or "AuthenticationResult.AccessToken")
 * Returns undefined if path doesn't exist
 */
function getNestedValue(obj: any, path: string): any {
	if (!path || !obj) {
		return undefined;
	}

	const keys = path.split('.');
	let current = obj;

	for (const key of keys) {
		if (current && typeof current === 'object' && key in current) {
			current = current[key];
		} else {
			return undefined;
		}
	}

	return current;
}

/**
 * Replace credential placeholders in a string value
 * Supports: {{$credentials.accessToken}}, {{$credentials.refreshToken}}
 */
function replacePlaceholders(value: any, credentials: ICredentialDataDecryptedObject): any {
	if (typeof value !== 'string') {
		return value;
	}

	let result = value;
	result = result.replace(
		/\{\{\$credentials\.accessToken\}\}/g,
		(credentials.accessToken as string) || '',
	);
	result = result.replace(
		/\{\{\$credentials\.refreshToken\}\}/g,
		(credentials.refreshToken as string) || '',
	);
	return result;
}

/**
 * Recursively replace credential placeholders in an object
 */
function replacePlaceholdersInObject(obj: any, credentials: ICredentialDataDecryptedObject): any {
	if (typeof obj !== 'object' || obj === null) {
		return replacePlaceholders(obj, credentials);
	}

	if (Array.isArray(obj)) {
		return obj.map((item) => replacePlaceholdersInObject(item, credentials));
	}

	const result: any = {};
	for (const key in obj) {
		if (obj.hasOwnProperty(key)) {
			result[key] = replacePlaceholdersInObject(obj[key], credentials);
		}
	}
	return result;
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
			description:
				'Use JSON to specify authentication values for headers, body and qs in the refresh token request.',
			placeholder: `{"headers": {...},"body": {...},"qs": {...}}`,
			default: `{
	"headers": {
		"User-Agent": "MyApp/1.0"
	},
	"body": {
		"grant_type": "refresh_token",
		"refresh_token": "{{$credentials.refreshToken}}",
		"client_id": "client_id_here",
		"client_secret": "client secret here",
		"access_type": "offline"
	},
	"qs": {}
}`,
		},
		{
			displayName: 'Common Request Template',
			name: 'commonRequestTemplate',
			type: 'json',
			required: false,
			description:
				'JSON template for headers and query parameters that will be applied to ALL requests (refresh, test, and main requests). Use this for device-info, User-Agent, or other common headers/params.',
			placeholder: `{"headers": {...}, "qs": {...}}`,
			default: `{
	"headers": {
		"User-Agent": "MyApp/1.0"
	},
	"qs": {}
}`,
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
			description: 'Hidden field needed for refreshing logics, do not remove!!!',
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
		// Initialize headers with Authorization header
		// Add space after prefix only if it's "Bearer" (standard format)
		// For other prefixes like "Bearer:", don't add space
		const prefix = credentials.authHeaderPrefix || 'Bearer';
		const separator = prefix === 'Bearer' ? ' ' : '';
		requestOptions.headers = {
			Authorization: `${prefix}${separator}${credentials.accessToken}`,
		};

		// Apply common request template (headers and qs) if provided
		// Note: commonRequestTemplate applies to ALL requests (refresh, test, and main)
		if (credentials.commonRequestTemplate) {
			try {
				const commonTemplate = jsonParse<IDataObject>(credentials.commonRequestTemplate as string, {
					errorMessage: 'Invalid Common Request Template JSON',
				});
				if (commonTemplate.headers) {
					requestOptions.headers = {
						...requestOptions.headers,
						...(commonTemplate.headers as IDataObject),
					};
				}
				if (commonTemplate.qs) {
					requestOptions.qs = {
						...(requestOptions.qs as IDataObject),
						...(commonTemplate.qs as IDataObject),
					};
				}
			} catch (error) {
				// Ignore parse errors, continue with default headers
			}
		}

		// NOTE: refreshRequestJson headers should NOT be applied here!
		// They are only used in preAuthentication() for the refresh request.
		// Main requests should only use Authorization + commonRequestTemplate.

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
	 * This method checks refresh mode and decides whether to refresh the token
	 */
	async preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject) {
		const actualRefreshTokenFieldName =
			(credentials.refreshTokenFieldName as string) || 'refresh_token';
		const actualAccessTokenFieldName =
			(credentials.accessTokenFieldName as string) || 'access_token';
		const accessToken = credentials.accessToken as string;
		const refreshTokenMode = (credentials.refreshTokenMode as string) || 'onJwtExpiry';
		const jwtExpiryLeewaySeconds = (credentials.jwtExpiryLeewaySeconds as number) || 60;

		// Check refresh mode and determine if we need to refresh
		let shouldRefresh = false;

		if (refreshTokenMode === 'never') {
			// Never refresh automatically - skip refresh logic (return empty object)
			return {};
		} else if (refreshTokenMode === 'always') {
			// Always refresh before each request
			shouldRefresh = true;
		} else if (refreshTokenMode === 'onJwtExpiry') {
			// Check JWT expiration and refresh if needed
			try {
				const payload = validateAndParseJwtPayload(accessToken);
				const exp = payload.exp as number;

				if (!exp) {
					// No exp claim - cannot determine expiration, refresh to be safe
					shouldRefresh = true;
				} else {
					// Check if token is expired or will expire soon
					const now = Math.floor(Date.now() / 1000);
					const expiresIn = exp - now;
					shouldRefresh = expiresIn <= jwtExpiryLeewaySeconds;
				}
			} catch (error) {
				// Invalid JWT or parsing error - refresh to get new token
				shouldRefresh = true;
			}
		} else if (refreshTokenMode === 'onTestEndpoint401') {
			// This mode is handled by the node, not in preAuthentication
			// Skip refresh here - node will retry with refresh on 401 (return empty object)
			return {};
		}

		// If we don't need to refresh, return empty object (no credential update)
		if (!shouldRefresh) {
			return {};
		}

		// Proceed with token refresh
		const refreshToken = credentials.refreshToken as string;
		const refreshUrl = credentials.refreshUrl as string;

		// 0) Initialize request options with url, method, default header content type as json
		const requestOptions: IHttpRequestOptions = {
			url: refreshUrl,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
		};

		// 1) Apply common request template first (applies to all requests)
		if (credentials.commonRequestTemplate) {
			try {
				const commonTemplate = jsonParse<IDataObject>(credentials.commonRequestTemplate as string, {
					errorMessage: 'Invalid Common Request Template JSON',
				});
				if (commonTemplate.headers) {
					requestOptions.headers = {
						...requestOptions.headers,
						...(commonTemplate.headers as IDataObject),
					};
				}
				if (commonTemplate.qs) {
					requestOptions.qs = {
						...(requestOptions.qs as IDataObject),
						...(commonTemplate.qs as IDataObject),
					};
				}
			} catch (error) {
				// Ignore parse errors, continue
			}
		}

		// 2) Parse JSON configuration for refresh request if provided
		let auth = jsonParse<IDataObject>((credentials.refreshRequestJson as string) || '{}', {
			errorMessage: 'Invalid Refresh Request Configuration JSON',
		});

		// Replace credential placeholders ({{$credentials.accessToken}}, {{$credentials.refreshToken}})
		auth = replacePlaceholdersInObject(auth, credentials) as IDataObject;

		// 3) Add all params from refreshConfig (overrides commonTemplate if conflicts)
		if (auth.headers) {
			requestOptions.headers = { ...requestOptions.headers, ...(auth.headers as IDataObject) };
		}

		// Initialize body
		if (auth.body) {
			requestOptions.body = {
				...(requestOptions.body as IDataObject),
				...(auth.body as IDataObject),
			};
		}

		if (auth.qs) {
			requestOptions.qs = { ...(requestOptions.qs as IDataObject), ...(auth.qs as IDataObject) };
		}

		// 2) Set access & refresh token
		// Check if refresh token field name exists in headers config
		const refreshTokenInHeader =
			auth.headers && actualRefreshTokenFieldName in (auth.headers as IDataObject);
		// Check if refresh token field name exists in body config
		const refreshTokenInBody =
			auth.body && actualRefreshTokenFieldName in (auth.body as IDataObject);
		// Check if refresh token field name exists in qs config
		const refreshTokenInQs = auth.qs && actualRefreshTokenFieldName in (auth.qs as IDataObject);
		// Check if access token field name exists in headers config
		const accessTokenInHeader =
			auth.headers && actualAccessTokenFieldName in (auth.headers as IDataObject);
		// Check if access token field name exists in body config
		const accessTokenInBody = auth.body && actualAccessTokenFieldName in (auth.body as IDataObject);
		// Check if access token field name exists in qs config
		const accessTokenInQs = auth.qs && actualAccessTokenFieldName in (auth.qs as IDataObject);

		// Set refresh token: if field name is in headers config -> header, if in body config -> body, if in qs config -> qs, else default to body
		if (refreshTokenInHeader) {
			// Set refresh token in header
			requestOptions.headers![actualRefreshTokenFieldName] = refreshToken;
		} else if (refreshTokenInBody) {
			// Set refresh token in body (already in bodyParams from config, just update value)
			(requestOptions.body! as IDataObject)[actualRefreshTokenFieldName] = refreshToken;
		} else if (refreshTokenInQs) {
			// Set refresh token in qs (already in qs from config, just update value)
			(requestOptions.qs! as IDataObject)[actualRefreshTokenFieldName] = refreshToken;
		} else {
			// Default: add refresh token to body
			if (!requestOptions.body) {
				requestOptions.body = {};
			}
			(requestOptions.body as IDataObject)[actualRefreshTokenFieldName] = refreshToken;
		}

		// Set access token: if field name is in headers config -> header, if in body config -> body, if in qs config -> qs
		if (accessTokenInHeader) {
			// Set access token in header
			requestOptions.headers![actualAccessTokenFieldName] = accessToken;
		} else if (accessTokenInBody) {
			// Set access token in body (already in bodyParams from config, just update value)
			(requestOptions.body! as IDataObject)[actualAccessTokenFieldName] = accessToken;
		} else if (accessTokenInQs) {
			// Set access token in qs (already in qs from config, just update value)
			(requestOptions.qs! as IDataObject)[actualAccessTokenFieldName] = accessToken;
		}

		// Determine if we should use form-urlencoded or JSON
		// If Content-Type is set to form-urlencoded in headers, use form format
		// const contentType =
		// 	requestOptions.headers?.['Content-Type'] || requestOptions.headers?.['content-type'];
		// const useFormData = contentType === 'application/x-www-form-urlencoded';

		// if (useFormData) {
		// 	// For form data, send as form-urlencoded string
		// 	const formData = new URLSearchParams();
		// 	for (const [key, value] of Object.entries(bodyParams)) {
		// 		formData.append(key, String(value));
		// 	}
		// 	requestOptions.body = formData.toString();
		// } else {
		// 	// JSON format (default)
		// 	requestOptions.json = true;
		// 	requestOptions.body = { ...(requestOptions.body as IDataObject), ...bodyParams };
		// }

		try {
			const response = await this.helpers.httpRequest(requestOptions);

			// Extract access token using dot notation path (supports nested fields like "AuthenticationResult.AccessToken")
			const newAccessToken = getNestedValue(response, actualAccessTokenFieldName);
			// Extract refresh token using dot notation path
			const newRefreshToken = getNestedValue(response, actualRefreshTokenFieldName);

			// Validate that access token exists in response
			if (!newAccessToken) {
				throw new Error('Access token not found in response');
			}

			// Validate that new access token is a valid JWT (throws if invalid)
			validateAndParseJwtPayload(newAccessToken);

			// Return updated credentials
			return {
				accessToken: newAccessToken,
				refreshToken: newRefreshToken || credentials.refreshToken,
				hidden: 'hidden',
			};
		} catch (error: any) {
			throw new Error(`Token refresh failed: ${error.message}`);
		}
	}
}
