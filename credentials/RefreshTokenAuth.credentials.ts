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

// eslint-disable-next-line n8n-nodes-base/cred-class-field-display-name-missing-api, n8n-nodes-base/cred-class-name-unsuffixed
export class RefreshTokenAuth implements ICredentialType {
	// eslint-disable-next-line n8n-nodes-base/cred-class-field-name-unsuffixed
	name = 'refreshTokenAuth';
	// extends = ['oAuth2Api'];
	// eslint-disable-next-line n8n-nodes-base/cred-class-field-display-name-missing-api
	displayName = 'Refresh Token Auth';
	icon: Icon = 'file:refresh-token-auth.svg';
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
			description: 'Field name in the refresh response that contains the new access token',
		},
		{
			displayName: 'Refresh Token Field Name',
			name: 'refreshTokenFieldName',
			type: 'string',
			// eslint-disable-next-line n8n-nodes-base/cred-class-field-type-options-password-missing
			typeOptions: { password: false },
			default: 'refresh_token',
			description: 'Field name for refresh token (used in both API request and response)',
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
		"refresh_token": "refresh token here",
		"client_id": "client_id_here",
		"client_secret": "client secret here",
		"access_type": "offline"
	},
	"qs": {}
}`,
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
	 */
	async authenticate(
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> {
		// Initialize headers with Authorization header
		requestOptions.headers = {
			Authorization: `${credentials.authHeaderPrefix || 'Bearer'} ${credentials.accessToken}`,
		};

		// Parse refreshRequestJson and add headers from it
		if (credentials.refreshRequestJson) {
			try {
				const refreshConfig = jsonParse<IDataObject>(credentials.refreshRequestJson as string, {
					errorMessage: 'Invalid Refresh Request Configuration JSON',
				});
				if (refreshConfig.headers) {
					requestOptions.headers = {
						...requestOptions.headers,
						...(refreshConfig.headers as IDataObject),
					};
				}
			} catch (error) {
				// Ignore parse errors, continue with default headers
			}
		}

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
	 * This method checks if the access token is expired and refreshes it if needed
	 */
	async preAuthentication(this: IHttpRequestHelper, credentials: ICredentialDataDecryptedObject) {
		const actualRefreshTokenFieldName =
			(credentials.refreshTokenFieldName as string) || 'refresh_token';
		const actualAccessTokenFieldName =
			(credentials.accessTokenFieldName as string) || 'access_token';
		const refreshToken = credentials.refreshToken as string;
		const accessToken = credentials.accessToken as string;
		const refreshUrl = credentials.refreshUrl as string;

		// 0) Initialize request options with url, method, default header content type as json
		const requestOptions: IHttpRequestOptions = {
			url: refreshUrl,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
		};

		// Parse JSON configuration if provided
		const auth = jsonParse<IDataObject>((credentials.refreshRequestJson as string) || '{}', {
			errorMessage: 'Invalid Refresh Request Configuration JSON',
		});

		// 1) Add all params from refreshConfig
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
		// Check if access token field name exists in headers config
		const accessTokenInHeader =
			auth.headers && actualAccessTokenFieldName in (auth.headers as IDataObject);
		// Check if access token field name exists in body config
		const accessTokenInBody = auth.body && actualAccessTokenFieldName in (auth.body as IDataObject);

		// Set refresh token: if field name is in headers config -> header, if in body config -> body, else default to body
		if (refreshTokenInHeader) {
			// Set refresh token in header
			requestOptions.headers![actualRefreshTokenFieldName] = refreshToken;
		} else if (refreshTokenInBody) {
			// Set refresh token in body (already in bodyParams from config, just update value)
			(requestOptions.body! as IDataObject)[actualRefreshTokenFieldName] = refreshToken;
		} else {
			// Default: add refresh token to body
			if (!requestOptions.body) {
				requestOptions.body = {};
			}
			(requestOptions.body as IDataObject)[actualRefreshTokenFieldName] = refreshToken;
		}

		// Set access token: if field name is in headers config -> header, if in body config -> body, else default to body
		if (accessTokenInHeader) {
			// Set access token in header
			requestOptions.headers![actualAccessTokenFieldName] = accessToken;
		} else if (accessTokenInBody) {
			// Set access token in body (already in bodyParams from config, just update value)
			(requestOptions.body! as IDataObject)[actualAccessTokenFieldName] = accessToken;
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
			const newAccessToken = response[actualAccessTokenFieldName];
			const newRefreshToken = response[actualRefreshTokenFieldName];

			// Validate that access token exists in response
			if (!newAccessToken) {
				throw new Error('Access token not found in response');
			}

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
