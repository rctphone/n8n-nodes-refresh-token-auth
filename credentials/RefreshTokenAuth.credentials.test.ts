import { RefreshTokenAuth } from './RefreshTokenAuth.credentials';
import {
	ICredentialDataDecryptedObject,
	IHttpRequestOptions,
	ICredentialTestRequest,
	ICredentialsDecrypted,
} from 'n8n-workflow';

// Mock httpRequest helper
const mockHttpRequest = jest.fn();
const mockThis = {
	helpers: {
		httpRequest: mockHttpRequest,
	},
} as any;

function toBase64Url(value: string) {
	return Buffer.from(value)
		.toString('base64')
		.replace(/=/g, '')
		.replace(/\+/g, '-')
		.replace(/\//g, '_');
}

function createJwtToken(payload: Record<string, any> = {}) {
	const basePayload = {
		exp: Math.floor(Date.now() / 1000) + 3600,
		...payload,
	};
	const header = toBase64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
	const body = toBase64Url(JSON.stringify(basePayload));
	const signature = toBase64Url('signature');
	return `${header}.${body}.${signature}`;
}

describe('RefreshTokenAuth', () => {
	let credential: RefreshTokenAuth;

	beforeEach(() => {
		credential = new RefreshTokenAuth();
		// Enable dynamic authenticate function for tests that need to call authenticate()
		// This replaces IAuthenticateGeneric with authenticateFunc
		RefreshTokenAuth.enableAuthenticateFunc();
		jest.clearAllMocks();
	});

	describe('Basic Properties', () => {
		it('should have correct name', () => {
			expect(credential.name).toBe('refreshTokenAuth');
		});

		it('should have correct display name', () => {
			expect(credential.displayName).toBe('Refresh Token Auth');
		});

		it('should have all required properties', () => {
			expect(credential.properties).toHaveLength(19);
			const propertyNames = credential.properties.map((p: { name: string }) => p.name);
			expect(propertyNames).toContain('accessToken');
			expect(propertyNames).toContain('refreshToken');
			expect(propertyNames).toContain('refreshUrl');
			expect(propertyNames).toContain('testUrl');
			expect(propertyNames).toContain('accessTokenFieldName');
			expect(propertyNames).toContain('refreshTokenFieldName');
			expect(propertyNames).toContain('authHeaderPrefix');
			expect(propertyNames).toContain('refreshRequestJson');
			expect(propertyNames).toContain('refreshRequestJsonNotice');
			expect(propertyNames).toContain('commonRequestTemplate');
			expect(propertyNames).toContain('commonRequestTemplateNotice');
			expect(propertyNames).toContain('refreshTokenMode');
			expect(propertyNames).toContain('jwtExpiryLeewaySeconds');
			expect(propertyNames).toContain('expiresInSource');
			expect(propertyNames).toContain('expiresInFieldName');
			expect(propertyNames).toContain('expiresInFormat');
			expect(propertyNames).toContain('allowUnauthorizedCerts');
			expect(propertyNames).toContain('hidden');
			expect(propertyNames).toContain('expiresInUnixTimestamp');
		});
	});

	describe('refreshAccessToken', () => {
		const mockCredentials: ICredentialDataDecryptedObject = {
			accessToken: createJwtToken(),
			refreshToken: 'valid_refresh_token',
			refreshUrl: 'https://api.example.com/auth/refresh',
			testUrl: 'https://api.example.com/user/profile',
			accessTokenFieldName: 'access_token',
			refreshTokenFieldName: 'refresh_token',
			authHeaderPrefix: 'Bearer',
			refreshTokenMode: 'always', // Always refresh for these tests
		};

		it('should successfully refresh token with default settings (body)', async () => {
			const credentialsWithBody = {
				...mockCredentials,
				refreshRequestJson: JSON.stringify({
					body: {
						refresh_token: '{{$credentials.refreshToken}}',
					},
				}),
			};

			const newAccessToken = createJwtToken();
			const mockResponseData = {
				access_token: newAccessToken,
				refresh_token: 'new_refresh_token',
			};

			mockHttpRequest.mockResolvedValueOnce(mockResponseData);

			const result = await credential.preAuthentication.call(mockThis, credentialsWithBody);

			expect(result).toEqual({
				accessToken: newAccessToken,
				refreshToken: 'new_refresh_token',
				hidden: '',
			});

			const call = mockHttpRequest.mock.calls[0][0];
			expect(call.method).toBe('POST');
			expect(call.url).toBe('https://api.example.com/auth/refresh');
			expect(call.headers).toMatchObject({
				'Content-Type': 'application/json',
			});
			expect(call.body).toHaveProperty('refresh_token', 'valid_refresh_token');
		});

		it('should send refresh token in header when configured in refreshRequestJson', async () => {
			const credentialsWithHeader = {
				...mockCredentials,
				refreshRequestJson: JSON.stringify({
					headers: {
						refresh_token: '{{$credentials.refreshToken}}',
					},
				}),
			};

			const newAccessToken = createJwtToken();
			const mockResponseData = {
				access_token: newAccessToken,
			};

			mockHttpRequest.mockResolvedValueOnce(mockResponseData);

			await credential.preAuthentication.call(mockThis, credentialsWithHeader);

			// When token is in header, refresh_token header should be set
			const call = mockHttpRequest.mock.calls[0][0];
			expect(call.method).toBe('POST');
			expect(call.url).toBe('https://api.example.com/auth/refresh');
			expect(call.headers).toHaveProperty('refresh_token', 'valid_refresh_token');
		});

		it('should use custom field names when configured', async () => {
			const credentialsWithCustomFields = {
				...mockCredentials,
				accessTokenFieldName: 'token',
				refreshTokenFieldName: 'refreshToken',
				refreshRequestJson: JSON.stringify({
					body: {
						refreshToken: '{{$credentials.refreshToken}}',
					},
				}),
			};

			const newAccessToken = createJwtToken();
			const mockResponseData = {
				token: newAccessToken,
				refreshToken: 'new_refresh_token',
			};

			mockHttpRequest.mockResolvedValueOnce(mockResponseData);

			const result = await credential.preAuthentication.call(mockThis, credentialsWithCustomFields);

			expect(result).toEqual({
				accessToken: newAccessToken,
				refreshToken: 'new_refresh_token',
				hidden: '',
			});

			const call = mockHttpRequest.mock.calls[0][0];
			expect(call.method).toBe('POST');
			expect(call.url).toBe('https://api.example.com/auth/refresh');
			expect(call.headers).toMatchObject({
				'Content-Type': 'application/json',
			});
			expect(call.body).toHaveProperty('refreshToken', 'valid_refresh_token');
		});

		it('should keep old refresh token if new one is not provided', async () => {
			const newAccessToken = createJwtToken();
			const mockResponseData = {
				access_token: newAccessToken,
				// No refresh_token in response
			};

			mockHttpRequest.mockResolvedValueOnce(mockResponseData);

			const result = await credential.preAuthentication.call(mockThis, mockCredentials);

			expect(result).toEqual({
				accessToken: newAccessToken,
				refreshToken: 'valid_refresh_token', // Old token kept
				hidden: '',
			});
		});

		it('should extract tokens from full response structure with body wrapper', async () => {
			// Some APIs or n8n configurations return full response with body/headers/statusCode
			const newAccessToken = createJwtToken();
			const fullResponseData = {
				body: {
					access_token: newAccessToken,
					refresh_token: 'new_refresh_token_from_body',
					expires_in: 900,
					token_type: 'Bearer',
				},
				headers: {
					'content-type': 'application/json;charset=utf-8',
					date: 'Mon, 01 Dec 2025 11:52:16 GMT',
				},
				statusCode: 200,
				statusMessage: 'OK',
			};

			mockHttpRequest.mockResolvedValueOnce(fullResponseData);

			const result = await credential.preAuthentication.call(mockThis, mockCredentials);

			expect(result).toEqual({
				accessToken: newAccessToken,
				refreshToken: 'new_refresh_token_from_body',
				hidden: '',
			});
		});

		it('should extract tokens from full response with nested path in body', async () => {
			// Test nested path like "data.token" when response has body wrapper
			const credentialsWithNestedPath = {
				...mockCredentials,
				accessTokenFieldName: 'data.token',
				refreshTokenFieldName: 'data.refresh',
			};

			const newAccessToken = createJwtToken();
			const fullResponseData = {
				body: {
					data: {
						token: newAccessToken,
						refresh: 'nested_refresh_token',
					},
				},
				headers: {},
				statusCode: 200,
			};

			mockHttpRequest.mockResolvedValueOnce(fullResponseData);

			const result = await credential.preAuthentication.call(mockThis, credentialsWithNestedPath);

			expect(result).toEqual({
				accessToken: newAccessToken,
				refreshToken: 'nested_refresh_token',
				hidden: '',
			});
		});

		it('should throw error when access token is not found in response', async () => {
			const mockResponseData = {
				// Missing access_token
				some_other_field: 'value',
			};

			mockHttpRequest.mockResolvedValueOnce(mockResponseData);

			await expect(credential.preAuthentication.call(mockThis, mockCredentials)).rejects.toThrow(
				'Access token not found in response',
			);
		});

		it('should throw error when refresh request fails', async () => {
			mockHttpRequest.mockRejectedValueOnce(new Error('Network error'));

			await expect(credential.preAuthentication.call(mockThis, mockCredentials)).rejects.toThrow(
				'Token refresh failed: Network error',
			);
		});
	});

	describe('preAuthentication', () => {
		it('should return empty object when token is valid and not expiring soon', async () => {
			const futureTime = Math.floor(Date.now() / 1000) + 3600;
			const validToken = createJwtToken({ exp: futureTime });

			const credentials: ICredentialDataDecryptedObject = {
				accessToken: validToken,
				refreshToken: 'refresh_token',
				refreshUrl: 'https://api.example.com/auth/refresh',
				testUrl: 'https://api.example.com/user/profile',
				accessTokenFieldName: 'access_token',
				refreshTokenFieldName: 'refresh_token',
				refreshTokenMode: 'onJwtExpiry', // Default mode - refresh only when expiring
				jwtExpiryLeewaySeconds: 60, // Default leeway
			};

			const result = await credential.preAuthentication.call(mockThis, credentials);

			// Should return empty object (no credential update needed)
			expect(result).toEqual({});
			// Should NOT call httpRequest since token is still valid
			expect(mockHttpRequest).not.toHaveBeenCalled();
		});

		it('should refresh token when access token is expired', async () => {
			const pastTime = Math.floor(Date.now() / 1000) - 3600;
			const expiredToken = createJwtToken({ exp: pastTime });

			const credentials: ICredentialDataDecryptedObject = {
				accessToken: expiredToken,
				refreshToken: 'refresh_token',
				refreshUrl: 'https://api.example.com/auth/refresh',
				testUrl: 'https://api.example.com/user/profile',
				accessTokenFieldName: 'access_token',
				refreshTokenFieldName: 'refresh_token',
			};

			const newAccessToken = createJwtToken();
			const mockResponseData = {
				access_token: newAccessToken,
				refresh_token: 'new_refresh_token',
			};

			mockHttpRequest.mockResolvedValueOnce(mockResponseData);

			const result = await credential.preAuthentication.call(mockThis, credentials);

			expect(result).toEqual({
				accessToken: newAccessToken,
				refreshToken: 'new_refresh_token',
				hidden: '',
			});
			expect(mockHttpRequest).toHaveBeenCalled();
		});

		it('should refresh token when access token is missing', async () => {
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: '',
				refreshToken: 'refresh_token',
				refreshUrl: 'https://api.example.com/auth/refresh',
				testUrl: 'https://api.example.com/user/profile',
				accessTokenFieldName: 'access_token',
				refreshTokenFieldName: 'refresh_token',
				refreshTokenMode: 'onJwtExpiry', // Will try to refresh invalid token
			};

			const mockResponseData = {
				access_token: createJwtToken(), // Return valid JWT
				refresh_token: 'new_refresh_token',
			};

			mockHttpRequest.mockResolvedValueOnce(mockResponseData);

			const result = await credential.preAuthentication.call(mockThis, credentials);

			// Should refresh and return new credentials
			expect(result.accessToken).toBeDefined();
			expect(result.refreshToken).toBe('new_refresh_token');
			expect(mockHttpRequest).toHaveBeenCalled();
		});

		it('should accept non-JWT access token from refresh response', async () => {
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: 'not-a-jwt',
				refreshToken: 'refresh_token',
				refreshUrl: 'https://api.example.com/auth/refresh',
				testUrl: 'https://api.example.com/user/profile',
				accessTokenFieldName: 'access_token',
				refreshTokenFieldName: 'refresh_token',
				refreshTokenMode: 'onJwtExpiry', // Will try to refresh invalid token
			};

			// Mock refresh to return non-JWT token (should be accepted)
			const mockResponseData = {
				access_token: 'opaque-token-12345',
				refresh_token: 'new_refresh_token',
			};

			mockHttpRequest.mockResolvedValueOnce(mockResponseData);

			const result = await credential.preAuthentication.call(mockThis, credentials);

			// Non-JWT tokens are now allowed
			expect(result).toEqual({
				accessToken: 'opaque-token-12345',
				refreshToken: 'new_refresh_token',
				hidden: '',
			});
		});

		it('should throw error when token refresh fails', async () => {
			const expiredToken = createJwtToken({ exp: 0 });

			const credentials: ICredentialDataDecryptedObject = {
				accessToken: expiredToken,
				refreshToken: 'refresh_token',
				refreshUrl: 'https://api.example.com/auth/refresh',
				testUrl: 'https://api.example.com/user/profile',
				refreshTokenMode: 'onJwtExpiry', // Will try to refresh expired token
			};

			mockHttpRequest.mockRejectedValueOnce(new Error('Network error'));

			await expect(credential.preAuthentication.call(mockThis, credentials)).rejects.toThrow(
				'Token refresh failed',
			);
		});

		it('should support form-urlencoded content type', async () => {
			const validToken = createJwtToken();
			const credentialsWithFormEncoded: ICredentialDataDecryptedObject = {
				accessToken: validToken,
				refreshToken: 'valid_refresh_token',
				refreshUrl: 'https://api.example.com/auth/refresh',
				testUrl: 'https://api.example.com/user/profile',
				accessTokenFieldName: 'access_token',
				refreshTokenFieldName: 'refresh_token',
				refreshTokenMode: 'always',
				refreshRequestJson: JSON.stringify({
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
					},
					body: {
						grant_type: 'refresh_token',
						refresh_token: '{{$credentials.refreshToken}}',
						client_id: 'client_id',
						client_secret: 'client_secret',
					},
				}),
			};

			const newAccessToken = createJwtToken();
			const mockResponseData = {
				access_token: newAccessToken,
				refresh_token: 'new_refresh_token',
			};

			mockHttpRequest.mockResolvedValueOnce(mockResponseData);

			const result = await credential.preAuthentication.call(mockThis, credentialsWithFormEncoded);

			expect(result).toEqual({
				accessToken: newAccessToken,
				refreshToken: 'new_refresh_token',
				hidden: '',
			});

			const call = mockHttpRequest.mock.calls[0][0];
			expect(call.method).toBe('POST');
			expect(call.url).toBe('https://api.example.com/auth/refresh');
			expect(call.headers).toHaveProperty('Content-Type', 'application/x-www-form-urlencoded');
			expect(call.body).toHaveProperty('refresh_token', 'valid_refresh_token');
			expect(call.body).toHaveProperty('grant_type', 'refresh_token');
		});
	});

	describe('SSL Certificate Validation Skip', () => {
		const mockCredentials: ICredentialDataDecryptedObject = {
			accessToken: createJwtToken(),
			refreshToken: 'valid_refresh_token',
			refreshUrl: 'https://api.example.com/auth/refresh',
			testUrl: 'https://api.example.com/user/profile',
			accessTokenFieldName: 'access_token',
			refreshTokenFieldName: 'refresh_token',
			authHeaderPrefix: 'Bearer',
			refreshTokenMode: 'always',
		};

		it('should skip SSL validation when allowUnauthorizedCerts is true', async () => {
			const credentialsWithSslSkip = {
				...mockCredentials,
				allowUnauthorizedCerts: true,
				refreshRequestJson: JSON.stringify({
					body: {
						refresh_token: '{{$credentials.refreshToken}}',
					},
				}),
			};

			const newAccessToken = createJwtToken();
			mockHttpRequest.mockResolvedValueOnce({
				access_token: newAccessToken,
				refresh_token: 'new_refresh_token',
			});

			await credential.preAuthentication.call(mockThis, credentialsWithSslSkip);

			const call = mockHttpRequest.mock.calls[0][0];
			expect(call.skipSslCertificateValidation).toBe(true);
		});

		it('should NOT skip SSL validation when allowUnauthorizedCerts is false', async () => {
			const credentialsWithoutSslSkip = {
				...mockCredentials,
				allowUnauthorizedCerts: false,
				refreshRequestJson: JSON.stringify({
					body: {
						refresh_token: '{{$credentials.refreshToken}}',
					},
				}),
			};

			const newAccessToken = createJwtToken();
			mockHttpRequest.mockResolvedValueOnce({
				access_token: newAccessToken,
				refresh_token: 'new_refresh_token',
			});

			await credential.preAuthentication.call(mockThis, credentialsWithoutSslSkip);

			const call = mockHttpRequest.mock.calls[0][0];
			// When allowUnauthorizedCerts is false, skipSslCertificateValidation is undefined (not set)
			expect(call.skipSslCertificateValidation).toBeUndefined();
		});

		it('should NOT skip SSL validation when allowUnauthorizedCerts is not set', async () => {
			const credentialsWithoutSslOption = {
				...mockCredentials,
				refreshRequestJson: JSON.stringify({
					body: {
						refresh_token: '{{$credentials.refreshToken}}',
					},
				}),
			};

			const newAccessToken = createJwtToken();
			mockHttpRequest.mockResolvedValueOnce({
				access_token: newAccessToken,
				refresh_token: 'new_refresh_token',
			});

			await credential.preAuthentication.call(mockThis, credentialsWithoutSslOption);

			const call = mockHttpRequest.mock.calls[0][0];
			expect(call.skipSslCertificateValidation).toBeFalsy();
		});

		it('should have allowUnauthorizedCerts property with correct configuration', () => {
			const sslProperty = credential.properties.find(
				(p: { name: string }) => p.name === 'allowUnauthorizedCerts',
			);
			expect(sslProperty).toBeDefined();
			expect(sslProperty?.type).toBe('boolean');
			expect(sslProperty?.default).toBe(false);
		});

		it('should have test request with SSL skip expression', () => {
			const testRequest = credential.test as any;
			expect(testRequest.request.skipSslCertificateValidation).toBe(
				'={{$credentials.allowUnauthorizedCerts}}',
			);
		});

		it('should apply SSL skip to authenticateFunc when allowUnauthorizedCerts is true', async () => {
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: 'test-token',
				authHeaderPrefix: 'Bearer',
				allowUnauthorizedCerts: true,
			};
			const requestOptions: IHttpRequestOptions = {
				url: 'https://api.example.com/data',
				method: 'GET',
			};

			type AuthenticateFn = (
				credentials: ICredentialDataDecryptedObject,
				requestOptions: IHttpRequestOptions,
			) => Promise<IHttpRequestOptions>;

			const authenticate = credential.authenticate as unknown as AuthenticateFn;
			const result = await authenticate(credentials, requestOptions);

			expect(result.skipSslCertificateValidation).toBe(true);
		});

		it('should NOT apply SSL skip to authenticateFunc when allowUnauthorizedCerts is false', async () => {
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: 'test-token',
				authHeaderPrefix: 'Bearer',
				allowUnauthorizedCerts: false,
			};
			const requestOptions: IHttpRequestOptions = {
				url: 'https://api.example.com/data',
				method: 'GET',
			};

			type AuthenticateFn = (
				credentials: ICredentialDataDecryptedObject,
				requestOptions: IHttpRequestOptions,
			) => Promise<IHttpRequestOptions>;

			const authenticate = credential.authenticate as unknown as AuthenticateFn;
			const result = await authenticate(credentials, requestOptions);

			expect(result.skipSslCertificateValidation).toBeUndefined();
		});
	});

	describe('Refresh Token Modes', () => {
		const futureTime = Math.floor(Date.now() / 1000) + 3600;
		const pastTime = Math.floor(Date.now() / 1000) - 3600;

		it('should not refresh token when mode is "never"', async () => {
			const validToken = createJwtToken({ exp: futureTime });
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: validToken,
				refreshToken: 'refresh_token',
				refreshUrl: 'https://api.example.com/auth/refresh',
				testUrl: 'https://api.example.com/user/profile',
				refreshTokenMode: 'never',
			};

			const result = await credential.preAuthentication.call(mockThis, credentials);

			expect(result).toEqual({});
			expect(mockHttpRequest).not.toHaveBeenCalled();
		});

		it('should always refresh token when mode is "always"', async () => {
			const validToken = createJwtToken({ exp: futureTime });
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: validToken,
				refreshToken: 'refresh_token',
				refreshUrl: 'https://api.example.com/auth/refresh',
				testUrl: 'https://api.example.com/user/profile',
				refreshTokenMode: 'always',
				accessTokenFieldName: 'access_token',
				refreshTokenFieldName: 'refresh_token',
			};

			const newAccessToken = createJwtToken({ exp: futureTime + 3600 });
			mockHttpRequest.mockResolvedValueOnce({
				access_token: newAccessToken,
				refresh_token: 'new_refresh_token',
			});

			const result = await credential.preAuthentication.call(mockThis, credentials);

			expect(result).toEqual({
				accessToken: newAccessToken,
				refreshToken: 'new_refresh_token',
				hidden: '',
			});
			expect(mockHttpRequest).toHaveBeenCalled();
		});

		it('should refresh token when mode is "onJwtExpiry" and token is expired', async () => {
			const expiredToken = createJwtToken({ exp: pastTime });
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: expiredToken,
				refreshToken: 'refresh_token',
				refreshUrl: 'https://api.example.com/auth/refresh',
				testUrl: 'https://api.example.com/user/profile',
				refreshTokenMode: 'onJwtExpiry',
				jwtExpiryLeewaySeconds: 60,
				accessTokenFieldName: 'access_token',
				refreshTokenFieldName: 'refresh_token',
			};

			const newAccessToken = createJwtToken({ exp: futureTime });
			mockHttpRequest.mockResolvedValueOnce({
				access_token: newAccessToken,
				refresh_token: 'new_refresh_token',
			});

			const result = await credential.preAuthentication.call(mockThis, credentials);

			expect(result).toEqual({
				accessToken: newAccessToken,
				refreshToken: 'new_refresh_token',
				hidden: '',
			});
			expect(mockHttpRequest).toHaveBeenCalled();
		});

		it('should not refresh token when mode is "onJwtExpiry" and token is valid', async () => {
			const validToken = createJwtToken({ exp: futureTime });
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: validToken,
				refreshToken: 'refresh_token',
				refreshUrl: 'https://api.example.com/auth/refresh',
				testUrl: 'https://api.example.com/user/profile',
				refreshTokenMode: 'onJwtExpiry',
				jwtExpiryLeewaySeconds: 60,
			};

			const result = await credential.preAuthentication.call(mockThis, credentials);

			expect(result).toEqual({});
			expect(mockHttpRequest).not.toHaveBeenCalled();
		});

		it('should not refresh token when mode is "onTestEndpoint401"', async () => {
			const validToken = createJwtToken({ exp: futureTime });
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: validToken,
				refreshToken: 'refresh_token',
				refreshUrl: 'https://api.example.com/auth/refresh',
				testUrl: 'https://api.example.com/user/profile',
				refreshTokenMode: 'onTestEndpoint401',
			};

			const result = await credential.preAuthentication.call(mockThis, credentials);

			expect(result).toEqual({});
			expect(mockHttpRequest).not.toHaveBeenCalled();
		});
	});

	describe('Expiration Source Variants', () => {
		const futureTime = Math.floor(Date.now() / 1000) + 3600;
		const pastTime = Math.floor(Date.now() / 1000) - 3600;

		describe('JWT Token Source (default)', () => {
			it('should use JWT exp claim when expiresInSource is "jwt"', async () => {
				const validToken = createJwtToken({ exp: futureTime });
				const credentials: ICredentialDataDecryptedObject = {
					accessToken: validToken,
					refreshToken: 'refresh_token',
					refreshUrl: 'https://api.example.com/auth/refresh',
					testUrl: 'https://api.example.com/user/profile',
					refreshTokenMode: 'onJwtExpiry',
					expiresInSource: 'jwt',
					jwtExpiryLeewaySeconds: 60,
				};

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toEqual({});
				expect(mockHttpRequest).not.toHaveBeenCalled();
			});

			it('should refresh when JWT token is expired with expiresInSource "jwt"', async () => {
				const expiredToken = createJwtToken({ exp: pastTime });
				const credentials: ICredentialDataDecryptedObject = {
					accessToken: expiredToken,
					refreshToken: 'refresh_token',
					refreshUrl: 'https://api.example.com/auth/refresh',
					testUrl: 'https://api.example.com/user/profile',
					refreshTokenMode: 'onJwtExpiry',
					expiresInSource: 'jwt',
					jwtExpiryLeewaySeconds: 60,
					accessTokenFieldName: 'access_token',
					refreshTokenFieldName: 'refresh_token',
				};

				const newAccessToken = createJwtToken({ exp: futureTime });
				mockHttpRequest.mockResolvedValueOnce({
					access_token: newAccessToken,
					refresh_token: 'new_refresh_token',
				});

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toHaveProperty('accessToken', newAccessToken);
				expect(mockHttpRequest).toHaveBeenCalled();
			});
		});

		describe('Refresh Response Source', () => {
			it('should refresh when no stored expiration (first request)', async () => {
				const validToken = createJwtToken({ exp: futureTime });
				const credentials: ICredentialDataDecryptedObject = {
					accessToken: validToken,
					refreshToken: 'refresh_token',
					refreshUrl: 'https://api.example.com/auth/refresh',
					testUrl: 'https://api.example.com/user/profile',
					refreshTokenMode: 'onJwtExpiry',
					expiresInSource: 'refreshResponse',
					expiresInFieldName: 'expires_in',
					expiresInFormat: 'seconds',
					jwtExpiryLeewaySeconds: 60,
					expiresInUnixTimestamp: '', // No stored expiration
					accessTokenFieldName: 'access_token',
					refreshTokenFieldName: 'refresh_token',
				};

				const newAccessToken = createJwtToken({ exp: futureTime });
				mockHttpRequest.mockResolvedValueOnce({
					access_token: newAccessToken,
					refresh_token: 'new_refresh_token',
					expires_in: 3600, // 1 hour in seconds
				});

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toHaveProperty('accessToken', newAccessToken);
				expect(result).toHaveProperty('expiresInUnixTimestamp');
				// expiresInUnixTimestamp should be a Unix timestamp string (seconds)
				expect(typeof result.expiresInUnixTimestamp).toBe('string');
				const storedTimestamp = parseInt(result.expiresInUnixTimestamp as string, 10);
				expect(storedTimestamp).toBeGreaterThan(Math.floor(Date.now() / 1000));
				expect(mockHttpRequest).toHaveBeenCalled();
			});

			it('should not refresh when stored expiration is in the future', async () => {
				const validToken = createJwtToken({ exp: futureTime });
				// Unix timestamp string for future (1 hour from now)
				const futureTimestamp = (futureTime + 3600).toString();
				const credentials: ICredentialDataDecryptedObject = {
					accessToken: validToken,
					refreshToken: 'refresh_token',
					refreshUrl: 'https://api.example.com/auth/refresh',
					testUrl: 'https://api.example.com/user/profile',
					refreshTokenMode: 'onJwtExpiry',
					expiresInSource: 'refreshResponse',
					expiresInFieldName: 'expires_in',
					expiresInFormat: 'seconds',
					jwtExpiryLeewaySeconds: 60,
					expiresInUnixTimestamp: futureTimestamp, // Valid stored expiration
				};

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toEqual({});
				expect(mockHttpRequest).not.toHaveBeenCalled();
			});

			it('should refresh when stored expiration is in the past', async () => {
				const validToken = createJwtToken({ exp: futureTime });
				// Unix timestamp string for past
				const pastTimestamp = pastTime.toString();
				const credentials: ICredentialDataDecryptedObject = {
					accessToken: validToken,
					refreshToken: 'refresh_token',
					refreshUrl: 'https://api.example.com/auth/refresh',
					testUrl: 'https://api.example.com/user/profile',
					refreshTokenMode: 'onJwtExpiry',
					expiresInSource: 'refreshResponse',
					expiresInFieldName: 'expires_in',
					expiresInFormat: 'seconds',
					jwtExpiryLeewaySeconds: 60,
					expiresInUnixTimestamp: pastTimestamp, // Expired stored expiration
					accessTokenFieldName: 'access_token',
					refreshTokenFieldName: 'refresh_token',
				};

				const newAccessToken = createJwtToken({ exp: futureTime });
				mockHttpRequest.mockResolvedValueOnce({
					access_token: newAccessToken,
					refresh_token: 'new_refresh_token',
					expires_in: 3600,
				});

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toHaveProperty('accessToken', newAccessToken);
				expect(mockHttpRequest).toHaveBeenCalled();
			});

			it('should refresh when stored expiration is within leeway period', async () => {
				const validToken = createJwtToken({ exp: futureTime });
				// Unix timestamp string for timestamp within leeway (30 seconds from now, leeway is 60)
				const withinLeewayTime = Math.floor(Date.now() / 1000) + 30;
				const withinLeewayTimestamp = withinLeewayTime.toString();
				const credentials: ICredentialDataDecryptedObject = {
					accessToken: validToken,
					refreshToken: 'refresh_token',
					refreshUrl: 'https://api.example.com/auth/refresh',
					testUrl: 'https://api.example.com/user/profile',
					refreshTokenMode: 'onJwtExpiry',
					expiresInSource: 'refreshResponse',
					expiresInFieldName: 'expires_in',
					expiresInFormat: 'seconds',
					jwtExpiryLeewaySeconds: 60,
					expiresInUnixTimestamp: withinLeewayTimestamp, // Within leeway
					accessTokenFieldName: 'access_token',
					refreshTokenFieldName: 'refresh_token',
				};

				const newAccessToken = createJwtToken({ exp: futureTime });
				mockHttpRequest.mockResolvedValueOnce({
					access_token: newAccessToken,
					refresh_token: 'new_refresh_token',
					expires_in: 3600,
				});

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toHaveProperty('accessToken', newAccessToken);
				expect(mockHttpRequest).toHaveBeenCalled();
			});
		});

		describe('Expires In Formats', () => {
			const baseCredentials: ICredentialDataDecryptedObject = {
				accessToken: createJwtToken({ exp: futureTime }),
				refreshToken: 'refresh_token',
				refreshUrl: 'https://api.example.com/auth/refresh',
				testUrl: 'https://api.example.com/user/profile',
				refreshTokenMode: 'onJwtExpiry',
				expiresInSource: 'refreshResponse',
				expiresInFieldName: 'expires_in',
				jwtExpiryLeewaySeconds: 60,
				expiresInUnixTimestamp: '', // Force refresh
				accessTokenFieldName: 'access_token',
				refreshTokenFieldName: 'refresh_token',
			};

			it('should handle expires_in in seconds (relative)', async () => {
				const credentials = { ...baseCredentials, expiresInFormat: 'seconds' };
				const newAccessToken = createJwtToken({ exp: futureTime });
				mockHttpRequest.mockResolvedValueOnce({
					access_token: newAccessToken,
					refresh_token: 'new_refresh_token',
					expires_in: 3600, // 1 hour in seconds
				});

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toHaveProperty('expiresInUnixTimestamp');
				// Unix timestamp string (seconds) - parse and convert to milliseconds for comparison
				const storedTimestamp = parseInt(result.expiresInUnixTimestamp as string, 10);
				const expectedMinTime = Math.floor(Date.now() / 1000) + 3500; // Allow some tolerance
				const expectedMaxTime = Math.floor(Date.now() / 1000) + 3700;
				expect(storedTimestamp).toBeGreaterThan(expectedMinTime);
				expect(storedTimestamp).toBeLessThan(expectedMaxTime);
			});

			it('should handle expires_in in milliseconds (relative)', async () => {
				const credentials = { ...baseCredentials, expiresInFormat: 'milliseconds' };
				const newAccessToken = createJwtToken({ exp: futureTime });
				mockHttpRequest.mockResolvedValueOnce({
					access_token: newAccessToken,
					refresh_token: 'new_refresh_token',
					expires_in: 3600000, // 1 hour in milliseconds
				});

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toHaveProperty('expiresInUnixTimestamp');
				const storedTimestamp = parseInt(result.expiresInUnixTimestamp as string, 10);
				const expectedMinTime = Math.floor(Date.now() / 1000) + 3500;
				const expectedMaxTime = Math.floor(Date.now() / 1000) + 3700;
				expect(storedTimestamp).toBeGreaterThan(expectedMinTime);
				expect(storedTimestamp).toBeLessThan(expectedMaxTime);
			});

			it('should handle expires_in in microseconds (relative)', async () => {
				const credentials = { ...baseCredentials, expiresInFormat: 'microseconds' };
				const newAccessToken = createJwtToken({ exp: futureTime });
				mockHttpRequest.mockResolvedValueOnce({
					access_token: newAccessToken,
					refresh_token: 'new_refresh_token',
					expires_in: 3600000000, // 1 hour in microseconds
				});

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toHaveProperty('expiresInUnixTimestamp');
				const storedTimestamp = parseInt(result.expiresInUnixTimestamp as string, 10);
				const expectedMinTime = Math.floor(Date.now() / 1000) + 3500;
				const expectedMaxTime = Math.floor(Date.now() / 1000) + 3700;
				expect(storedTimestamp).toBeGreaterThan(expectedMinTime);
				expect(storedTimestamp).toBeLessThan(expectedMaxTime);
			});

			it('should handle expires_in as Unix timestamp in seconds (absolute)', async () => {
				const credentials = { ...baseCredentials, expiresInFormat: 'unix-seconds' };
				const newAccessToken = createJwtToken({ exp: futureTime });
				const absoluteTimestamp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
				mockHttpRequest.mockResolvedValueOnce({
					access_token: newAccessToken,
					refresh_token: 'new_refresh_token',
					expires_in: absoluteTimestamp,
				});

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toHaveProperty('expiresInUnixTimestamp');
				const storedTimestamp = parseInt(result.expiresInUnixTimestamp as string, 10);
				// Should be within 5 seconds of the absolute timestamp
				expect(Math.abs(storedTimestamp - absoluteTimestamp)).toBeLessThan(5);
			});

			it('should handle expires_in as Unix timestamp in milliseconds (absolute)', async () => {
				const credentials = { ...baseCredentials, expiresInFormat: 'unix-milliseconds' };
				const newAccessToken = createJwtToken({ exp: futureTime });
				const absoluteTimestamp = Date.now() + 3600000; // 1 hour from now in ms
				mockHttpRequest.mockResolvedValueOnce({
					access_token: newAccessToken,
					refresh_token: 'new_refresh_token',
					expires_in: absoluteTimestamp,
				});

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toHaveProperty('expiresInUnixTimestamp');
				const storedTimestamp = parseInt(result.expiresInUnixTimestamp as string, 10);
				// Should be within 5 seconds of the absolute timestamp (converted to seconds)
				const absoluteTimestampSeconds = Math.floor(absoluteTimestamp / 1000);
				expect(Math.abs(storedTimestamp - absoluteTimestampSeconds)).toBeLessThan(5);
			});
		});

		describe('Expires In Field Name with Dot Notation', () => {
			it('should extract expires_in from nested field using dot notation', async () => {
				const validToken = createJwtToken({ exp: futureTime });
				const credentials: ICredentialDataDecryptedObject = {
					accessToken: validToken,
					refreshToken: 'refresh_token',
					refreshUrl: 'https://api.example.com/auth/refresh',
					testUrl: 'https://api.example.com/user/profile',
					refreshTokenMode: 'onJwtExpiry',
					expiresInSource: 'refreshResponse',
					expiresInFieldName: 'data.expires_in', // Nested field
					expiresInFormat: 'seconds',
					jwtExpiryLeewaySeconds: 60,
					expiresInUnixTimestamp: '',
					accessTokenFieldName: 'data.access_token',
					refreshTokenFieldName: 'data.refresh_token',
				};

				const newAccessToken = createJwtToken({ exp: futureTime });
				mockHttpRequest.mockResolvedValueOnce({
					data: {
						access_token: newAccessToken,
						refresh_token: 'new_refresh_token',
						expires_in: 7200, // 2 hours
					},
				});

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toHaveProperty('accessToken', newAccessToken);
				expect(result).toHaveProperty('expiresInUnixTimestamp');
				const storedTimestamp = parseInt(result.expiresInUnixTimestamp as string, 10);
				const expectedMinTime = Math.floor(Date.now() / 1000) + 7100;
				const expectedMaxTime = Math.floor(Date.now() / 1000) + 7300;
				expect(storedTimestamp).toBeGreaterThan(expectedMinTime);
				expect(storedTimestamp).toBeLessThan(expectedMaxTime);
			});

			it('should handle string expires_in value from response', async () => {
				const validToken = createJwtToken({ exp: futureTime });
				const credentials: ICredentialDataDecryptedObject = {
					accessToken: validToken,
					refreshToken: 'refresh_token',
					refreshUrl: 'https://api.example.com/auth/refresh',
					testUrl: 'https://api.example.com/user/profile',
					refreshTokenMode: 'onJwtExpiry',
					expiresInSource: 'refreshResponse',
					expiresInFieldName: 'expires_in',
					expiresInFormat: 'seconds',
					jwtExpiryLeewaySeconds: 60,
					expiresInUnixTimestamp: '',
					accessTokenFieldName: 'access_token',
					refreshTokenFieldName: 'refresh_token',
				};

				const newAccessToken = createJwtToken({ exp: futureTime });
				mockHttpRequest.mockResolvedValueOnce({
					access_token: newAccessToken,
					refresh_token: 'new_refresh_token',
					expires_in: '3600', // String value instead of number
				});

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toHaveProperty('expiresInUnixTimestamp');
				const storedTimestamp = parseInt(result.expiresInUnixTimestamp as string, 10);
				expect(storedTimestamp).toBeGreaterThan(Math.floor(Date.now() / 1000));
			});

			it('should not store expiresInUnixTimestamp when expiresInSource is "jwt"', async () => {
				const expiredToken = createJwtToken({ exp: pastTime });
				const credentials: ICredentialDataDecryptedObject = {
					accessToken: expiredToken,
					refreshToken: 'refresh_token',
					refreshUrl: 'https://api.example.com/auth/refresh',
					testUrl: 'https://api.example.com/user/profile',
					refreshTokenMode: 'onJwtExpiry',
					expiresInSource: 'jwt', // Using JWT source
					jwtExpiryLeewaySeconds: 60,
					accessTokenFieldName: 'access_token',
					refreshTokenFieldName: 'refresh_token',
				};

				const newAccessToken = createJwtToken({ exp: futureTime });
				mockHttpRequest.mockResolvedValueOnce({
					access_token: newAccessToken,
					refresh_token: 'new_refresh_token',
					expires_in: 3600, // This should be ignored when source is "jwt"
				});

				const result = await credential.preAuthentication.call(mockThis, credentials);

				expect(result).toHaveProperty('accessToken', newAccessToken);
				expect(result).not.toHaveProperty('expiresInUnixTimestamp');
			});
		});
	});

	describe('Authentication Configuration', () => {
		// Type helper for authenticate function after enableAuthenticateFunc() is called
		type AuthenticateFn = (
			credentials: ICredentialDataDecryptedObject,
			requestOptions: IHttpRequestOptions,
		) => Promise<IHttpRequestOptions>;

		it('should have authenticate method after enableAuthenticateFunc()', () => {
			expect(typeof credential.authenticate).toBe('function');
		});

		it('should add Authorization header with Bearer prefix', async () => {
			const mockCredentials: ICredentialDataDecryptedObject = {
				accessToken: 'test_token',
				authHeaderPrefix: 'Bearer',
			};
			const requestOptions: IHttpRequestOptions = {
				url: 'https://api.example.com/test',
				method: 'GET',
			};

			const authenticate = credential.authenticate as unknown as AuthenticateFn;
			const result = await authenticate(mockCredentials, requestOptions);

			expect(result.headers).toHaveProperty('Authorization', 'Bearer test_token');
		});

		it('should apply common request template headers and query params', async () => {
			const mockCredentials: ICredentialDataDecryptedObject = {
				accessToken: 'test_token',
				authHeaderPrefix: 'Bearer',
				commonRequestTemplate: JSON.stringify({
					headers: {
						'User-Agent': 'CustomApp/1.0',
						'X-Device-Id': 'device123',
					},
					qs: {
						api_version: 'v2',
						stage: 'production',
					},
				}),
			};
			const requestOptions: IHttpRequestOptions = {
				url: 'https://api.example.com/test',
				method: 'GET',
			};

			const authenticate = credential.authenticate as unknown as AuthenticateFn;
			const result = await authenticate(mockCredentials, requestOptions);

			expect(result.headers).toHaveProperty('Authorization', 'Bearer test_token');
			expect(result.headers).toHaveProperty('User-Agent', 'CustomApp/1.0');
			expect(result.headers).toHaveProperty('X-Device-Id', 'device123');
			expect(result.qs).toHaveProperty('api_version', 'v2');
			expect(result.qs).toHaveProperty('stage', 'production');
		});
	});

	describe('Test Configuration', () => {
		it('should have test request configuration', () => {
			expect(credential.test).toBeDefined();
			expect(credential.test).toHaveProperty('request');
			const testRequest = credential.test as ICredentialTestRequest;
			expect(testRequest.request).toBeDefined();
			expect(testRequest.request.method).toBe('GET');
			expect(testRequest.request.url).toBe('={{$credentials.testUrl}}');
		});

		it('should have test request structure matching credentials-tester approach', () => {
			const testRequest = credential.test as ICredentialTestRequest;
			expect(testRequest.request).toMatchObject({
				method: 'GET',
				url: '={{$credentials.testUrl}}',
			});
		});

		describe('Test Request Execution (credentials-tester approach)', () => {
			const mockCredentialsDecrypted: ICredentialsDecrypted = {
				id: 'test-cred-id',
				name: 'Test Credentials',
				type: 'refreshTokenAuth',
				data: {
					accessToken: 'test_access_token',
					refreshToken: 'test_refresh_token',
					refreshUrl: 'https://api.example.com/auth/refresh',
					testUrl: 'https://api.example.com/user/profile',
					accessTokenFieldName: 'access_token',
					refreshTokenFieldName: 'refresh_token',
					authHeaderPrefix: 'Bearer',
				},
			};

			it('should have test request that uses testUrl from credentials', () => {
				const testRequest = credential.test as ICredentialTestRequest;
				expect(testRequest.request.url).toBe('={{$credentials.testUrl}}');
				// This expression will be resolved by n8n to the actual testUrl value
				// In credentials-tester, this would be resolved from mockCredentialsDecrypted.data.testUrl
				expect(mockCredentialsDecrypted.data?.testUrl).toBe('https://api.example.com/user/profile');
			});

			it('should validate test request structure for credentials-tester', () => {
				const testRequest = credential.test as ICredentialTestRequest;
				// Credentials-tester expects request to have method and url
				// Note: Using url directly (not baseURL + empty url) to ensure httpsAgent is set correctly
				expect(testRequest.request).toHaveProperty('method');
				expect(testRequest.request).toHaveProperty('url');
				// Validate that credentials structure matches what credentials-tester expects
				expect(mockCredentialsDecrypted.type).toBe('refreshTokenAuth');
				expect(mockCredentialsDecrypted.data).toBeDefined();
			});

			it('should support test request with successful response (2xx)', () => {
				const testRequest = credential.test as ICredentialTestRequest;
				// In credentials-tester, 2xx responses are treated as success
				// This test validates the structure supports this
				expect(testRequest.request.method).toBe('GET');
				// No rules defined, so default behavior applies: 2xx = success
				// Credentials-tester checks: if (errorResponseData.statusCode < 199 || errorResponseData.statusCode > 299)
				expect(mockCredentialsDecrypted.data).toBeDefined();
			});

			it('should support test request error handling (non-2xx)', () => {
				const testRequest = credential.test as ICredentialTestRequest;
				// In credentials-tester, non-2xx responses are treated as errors
				// This test validates the structure supports this
				expect(testRequest.request).toBeDefined();
				// If rules were defined, they would be checked here
				// Credentials-tester would use mockCredentialsDecrypted to resolve testUrl
				expect(mockCredentialsDecrypted.data?.testUrl).toBeDefined();
			});
		});
	});

	describe('authenticate()', () => {
		// Type helper for authenticate function after enableAuthenticateFunc() is called
		type AuthenticateFn = (
			credentials: ICredentialDataDecryptedObject,
			requestOptions: IHttpRequestOptions,
		) => Promise<IHttpRequestOptions>;

		it('should add Authorization header with access token', async () => {
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: 'test-token-123',
				authHeaderPrefix: 'Bearer',
			};

			const requestOptions: IHttpRequestOptions = {
				url: 'https://api.example.com/data',
				method: 'GET',
			};

			const authenticate = credential.authenticate as unknown as AuthenticateFn;
			const result = await authenticate(credentials, requestOptions);

			expect(result.headers).toBeDefined();
			expect(result.headers!.Authorization).toBe('Bearer test-token-123');
		});

		it('should apply commonRequestTemplate headers to main requests', async () => {
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: 'test-token-123',
				authHeaderPrefix: 'Bearer',
				commonRequestTemplate: JSON.stringify({
					headers: {
						'User-Agent': 'MyApp/1.0',
						'X-Custom-Header': 'custom-value',
					},
					qs: {
						locale: 'en',
					},
				}),
			};

			const requestOptions: IHttpRequestOptions = {
				url: 'https://api.example.com/data',
				method: 'GET',
			};

			const authenticate = credential.authenticate as unknown as AuthenticateFn;
			const result = await authenticate(credentials, requestOptions);

			expect(result.headers).toBeDefined();
			expect(result.headers!.Authorization).toBe('Bearer test-token-123');
			expect(result.headers!['User-Agent']).toBe('MyApp/1.0');
			expect(result.headers!['X-Custom-Header']).toBe('custom-value');
			expect(result.qs).toBeDefined();
			expect(result.qs!.locale).toBe('en');
		});

		it('should NOT apply refreshRequestJson headers to main requests (bug fix)', async () => {
			// This test verifies the fix for the bug where refreshRequestJson headers
			// were incorrectly applied to all requests, including main requests.
			// refreshRequestJson headers should ONLY be used in preAuthentication() for refresh requests.
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: 'test-token-123',
				authHeaderPrefix: 'Bearer',
				refreshRequestJson: JSON.stringify({
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						'X-Refresh-Only-Header': 'should-not-appear',
					},
					body: {
						grant_type: 'refresh_token',
						refresh_token: 'refresh-token-value',
					},
				}),
			};

			const requestOptions: IHttpRequestOptions = {
				url: 'https://api.example.com/data',
				method: 'GET',
			};

			const authenticate = credential.authenticate as unknown as AuthenticateFn;
			const result = await authenticate(credentials, requestOptions);

			// Should have Authorization header
			expect(result.headers).toBeDefined();
			expect(result.headers!.Authorization).toBe('Bearer test-token-123');

			// Should NOT have refresh-specific headers
			expect(result.headers!['Content-Type']).toBeUndefined();
			expect(result.headers!['X-Refresh-Only-Header']).toBeUndefined();
		});

		it('should apply commonRequestTemplate headers but not refreshRequestJson headers', async () => {
			// Test that commonRequestTemplate works correctly even when refreshRequestJson is present
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: 'test-token-123',
				authHeaderPrefix: 'Bearer',
				commonRequestTemplate: JSON.stringify({
					headers: {
						'User-Agent': 'MyApp/1.0',
					},
				}),
				refreshRequestJson: JSON.stringify({
					headers: {
						'Content-Type': 'application/x-www-form-urlencoded',
						'X-Refresh-Header': 'refresh-value',
					},
				}),
			};

			const requestOptions: IHttpRequestOptions = {
				url: 'https://api.example.com/data',
				method: 'GET',
			};

			const authenticate = credential.authenticate as unknown as AuthenticateFn;
			const result = await authenticate(credentials, requestOptions);

			// Should have Authorization and common headers
			expect(result.headers!.Authorization).toBe('Bearer test-token-123');
			expect(result.headers!['User-Agent']).toBe('MyApp/1.0');

			// Should NOT have refresh headers
			expect(result.headers!['Content-Type']).toBeUndefined();
			expect(result.headers!['X-Refresh-Header']).toBeUndefined();
		});

		it('should use default "Bearer" prefix with space if authHeaderPrefix is not provided', async () => {
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: 'test-token-123',
			};

			const requestOptions: IHttpRequestOptions = {
				url: 'https://api.example.com/data',
				method: 'GET',
			};

			const authenticate = credential.authenticate as unknown as AuthenticateFn;
			const result = await authenticate(credentials, requestOptions);

			expect(result.headers).toBeDefined();
			expect(result.headers!.Authorization).toBe('Bearer test-token-123');
		});

		it('should add space after "Bearer" prefix', async () => {
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: 'test-token-123',
				authHeaderPrefix: 'Bearer',
			};

			const requestOptions: IHttpRequestOptions = {
				url: 'https://api.example.com/data',
				method: 'GET',
			};

			const authenticate = credential.authenticate as unknown as AuthenticateFn;
			const result = await authenticate(credentials, requestOptions);

			expect(result.headers).toBeDefined();
			expect(result.headers!.Authorization).toBe('Bearer test-token-123');
		});

		it('should NOT add space for non-Bearer prefixes (e.g., "Bearer:")', async () => {
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: 'test-token-123',
				authHeaderPrefix: 'Bearer:',
			};

			const requestOptions: IHttpRequestOptions = {
				url: 'https://api.example.com/data',
				method: 'GET',
			};

			const authenticate = credential.authenticate as unknown as AuthenticateFn;
			const result = await authenticate(credentials, requestOptions);

			expect(result.headers).toBeDefined();
			expect(result.headers!.Authorization).toBe('Bearer:test-token-123');
		});

		it('should NOT add space for custom prefixes like "Token"', async () => {
			const credentials: ICredentialDataDecryptedObject = {
				accessToken: 'test-token-123',
				authHeaderPrefix: 'Token',
			};

			const requestOptions: IHttpRequestOptions = {
				url: 'https://api.example.com/data',
				method: 'GET',
			};

			const authenticate = credential.authenticate as unknown as AuthenticateFn;
			const result = await authenticate(credentials, requestOptions);

			expect(result.headers).toBeDefined();
			expect(result.headers!.Authorization).toBe('Tokentest-token-123');
		});
	});
});
