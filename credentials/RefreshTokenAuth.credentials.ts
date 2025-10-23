import {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	INodeProperties,
	ICredentialDataDecryptedObject,
	IHttpRequestHelper,
	IHttpRequestOptions,
} from 'n8n-workflow';

export class RefreshTokenAuth implements ICredentialType {
	name = 'refreshTokenAuth';
	// extends = ['oAuth2Api'];
	displayName = 'Refresh Token Auth';
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
			typeOptions: { password: true },
			default: 'access_token',
			description: 'Field name in the refresh response that contains the new access token',
		},
		{
			displayName: 'Refresh Token Field Name',
			name: 'refreshTokenFieldName',
			type: 'string',
			typeOptions: { password: true },
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
			displayName: 'Send Refresh Token As',
			name: 'refreshTokenLocation',
			type: 'options',
			options: [
				{
					name: 'Body',
					value: 'body',
				},
				{
					name: 'Header',
					value: 'header',
				},
			],
			default: 'header',
			description: 'Where to send the refresh token in the refresh request',
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
	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				Authorization:
					'={{$credentials.authHeaderPrefix || "Bearer"}} {{$credentials.accessToken}}',
			},
		},
	};

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
		const actualRefreshTokenLocation = (credentials.refreshTokenLocation as string) || 'header';
		const actualAccessTokenFieldName =
			(credentials.accessTokenFieldName as string) || 'access_token';
		const refreshToken = credentials.refreshToken as string;

		const requestOptions: IHttpRequestOptions = {
			url: credentials.refreshUrl as string,
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
		};

		if (actualRefreshTokenLocation === 'header') {
			requestOptions.headers!.Authorization = `Bearer ${refreshToken}`;
		} else {
			requestOptions.json = true;
			requestOptions.body = {
				[actualRefreshTokenFieldName]: refreshToken,
			};
		}

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
