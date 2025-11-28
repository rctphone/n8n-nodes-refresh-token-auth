import { RefreshToken } from './RefreshToken.node';
import type {
	IExecuteFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	IDataObject,
	ICredentialDataDecryptedObject,
} from 'n8n-workflow';

// Mock invokeAxios from n8n-core
jest.mock(
	'n8n-core/dist/execution-engine/node-execution-context/utils/request-helper-functions',
	() => {
		const actual = jest.requireActual(
			'n8n-core/dist/execution-engine/node-execution-context/utils/request-helper-functions',
		);
		return {
			...actual,
			invokeAxios: jest.fn(),
		};
	},
);

import { invokeAxios } from 'n8n-core/dist/execution-engine/node-execution-context/utils/request-helper-functions';

// Mock credentials data
const mockCredentials = {
	accessToken: 'old_access_token',
	refreshToken: 'valid_refresh_token',
	refreshUrl: 'https://api.example.com/auth/refresh',
	testUrl: 'https://api.example.com/user/profile',
	accessTokenFieldName: 'access_token',
	refreshTokenFieldName: 'refresh_token',
	authHeaderPrefix: 'Bearer',
} as IDataObject;

// Mock HTTP responses
const mockRefreshTokenResponse: IN8nHttpFullResponse = {
	body: {
		access_token: 'new_access_token',
		refresh_token: 'new_refresh_token',
	},
	headers: { 'content-type': 'application/json' },
	statusCode: 200,
	statusMessage: 'OK',
};

const mockMainRequestResponse: IN8nHttpFullResponse = {
	body: {
		success: true,
		data: { id: 123, name: 'Test User' },
	},
	headers: { 'content-type': 'application/json' },
	statusCode: 200,
	statusMessage: 'OK',
};

describe('RefreshToken Node', () => {
	let node: RefreshToken;
	let mockExecuteFunctions: Partial<IExecuteFunctions>;

	beforeEach(() => {
		node = new RefreshToken();
		jest.clearAllMocks();

		// Mock invokeAxios to return appropriate responses based on URL
		(invokeAxios as jest.Mock).mockImplementation(async (axiosRequest: any) => {
			const url = String(
				(axiosRequest.baseURL || '') + (axiosRequest.url || axiosRequest.baseURL || ''),
			);

			// Check if URL matches refresh URL from credentials or looks like a token refresh endpoint
			const refreshUrl = mockCredentials.refreshUrl as string;
			const isPreAuth = url === refreshUrl;

			if (isPreAuth) {
				return {
					data: mockRefreshTokenResponse.body,
					headers: mockRefreshTokenResponse.headers,
					status: mockRefreshTokenResponse.statusCode,
					statusText: mockRefreshTokenResponse.statusMessage,
				};
			}
			return {
				data: mockMainRequestResponse.body,
				headers: mockMainRequestResponse.headers,
				status: mockMainRequestResponse.statusCode,
				statusText: mockMainRequestResponse.statusMessage,
			};
		});

		// Track all httpRequest calls
		const httpRequestCalls: Array<{ options: IHttpRequestOptions; isPreAuth: boolean }> = [];

		// Mock httpRequest helper (captures both pre-auth and main requests)
		const mockHttpRequest = jest.fn(
			async (requestOptions: IHttpRequestOptions): Promise<IN8nHttpFullResponse> => {
				const url = String(requestOptions.url || '');
				const isPreAuth = url.includes('/auth/refresh') || url.includes('/oauth/token');

				httpRequestCalls.push({ options: requestOptions, isPreAuth });

				if (isPreAuth) {
					return mockRefreshTokenResponse;
				}
				return mockMainRequestResponse;
			},
		);

		// Mock httpRequestWithAuthentication (uses credentials and triggers pre-auth)
		const mockHttpRequestWithAuthentication = async function (
			this: IExecuteFunctions,
			credentialType: string,
			requestOptions: IHttpRequestOptions,
		): Promise<IN8nHttpFullResponse> {
			// Simulate credential authentication flow
			// First, check if token needs refresh (simulate expired token)
			const needsRefresh = true; // For testing, always refresh

			// IMPORTANT: use this.helpers.httpRequest which will be the intercepted version from the node
			const httpRequest = this.helpers.httpRequest.bind(this.helpers);

			if (needsRefresh) {
				// Pre-auth request to refresh token
				const refreshOptions: IHttpRequestOptions = {
					method: 'POST',
					url: mockCredentials.refreshUrl as string,
					body: {
						refresh_token: mockCredentials.refreshToken,
						grant_type: 'refresh_token',
					},
					json: true,
					returnFullResponse: true,
				};

				await httpRequest(refreshOptions);
			}

			// Add Authorization header to main request
			const authenticatedOptions: IHttpRequestOptions = {
				...requestOptions,
				headers: {
					...requestOptions.headers,
					Authorization: `Bearer ${mockCredentials.accessToken}`,
				},
				returnFullResponse: true,
			};

			return await httpRequest(authenticatedOptions);
		};

		// Create mock IExecuteFunctions
		mockExecuteFunctions = {
			getInputData: jest.fn(() => [
				{
					json: {},
					binary: {},
				},
			]),

			getNodeParameter: jest.fn((parameterName: string, itemIndex: number, defaultValue?: any) => {
				const params: Record<string, any> = {
					url: 'https://api.example.com/v1/users',
					method: 'GET',
					qsJson: {},
					headersJson: {},
					bodyJson: {},
					sendPreauth: true,
					sendMain: true,
					redact: false,
					truncate: 10000,
				};
				return params[parameterName] ?? defaultValue;
			}),

			getCredentials: jest.fn(async (type: string) => {
				if (type === 'refreshTokenAuth') {
					return mockCredentials as ICredentialDataDecryptedObject;
				}
				return {} as ICredentialDataDecryptedObject;
			}) as any,

			logger: {
				debug: jest.fn(),
				info: jest.fn(),
				warn: jest.fn(),
				error: jest.fn(),
			} as any,

			helpers: {
				httpRequest: mockHttpRequest,
				httpRequestWithAuthentication: mockHttpRequestWithAuthentication,
			} as any,
		};
	});

	describe('Basic Execution', () => {
		it('should execute successfully with GET request', async () => {
			const result = await node.execute.call(mockExecuteFunctions as IExecuteFunctions);

			expect(result).toBeDefined();
			expect(result).toHaveLength(1);
			expect(result[0]).toHaveLength(1);

			const output = result[0][0];
			expect(output.json).toBeDefined();
			const json = output.json as IDataObject;
			expect(json.events).toBeDefined();
			expect(Array.isArray(json.events)).toBe(true);
			const events = json.events as Array<any>;
			expect(events.length).toBeGreaterThan(0);
		});

		it('should capture pre-auth and main requests', async () => {
			const result = await node.execute.call(mockExecuteFunctions as IExecuteFunctions);

			const output = result[0][0];
			const json = output.json as IDataObject;
			const events = json.events as Array<any> | undefined;

			expect(events).toBeDefined();
			expect(Array.isArray(events)).toBe(true);
			if (events) {
				expect(events.length).toBeGreaterThan(0);
			}

			// Should have at least one pre-auth event and one main event
			const preAuthEvents = events?.filter((e) => e.isPreAuth === true) || [];
			const mainEvents = events?.filter((e) => e.isPreAuth === false) || [];

			expect(preAuthEvents.length).toBeGreaterThan(0);
			expect(mainEvents.length).toBeGreaterThan(0);

			// Check pre-auth event structure
			const preAuthRequest = preAuthEvents.find((e) => e.stage === 'request');
			expect(preAuthRequest).toBeDefined();
			expect(preAuthRequest?.url).toContain('refresh');
			const preAuthResponse = preAuthEvents.find((e) => e.stage === 'response');
			expect(preAuthResponse).toBeDefined();
			expect(preAuthResponse?.statusCode).toBe(200);

			// Check main event structure
			const mainRequest = mainEvents.find((e) => e.stage === 'request');
			expect(mainRequest).toBeDefined();
			expect(mainRequest?.url).toBe('https://api.example.com/v1/users');
			const mainResponse = mainEvents.find((e) => e.stage === 'response');
			expect(mainResponse).toBeDefined();
			expect(mainResponse?.statusCode).toBe(200);
		});

		it('should include events timeline', async () => {
			const result = await node.execute.call(mockExecuteFunctions as IExecuteFunctions);

			const output = result[0][0];
			const json = output.json as IDataObject;
			expect(json.events).toBeDefined();
			expect(Array.isArray(json.events)).toBe(true);
			const events = json.events as Array<IDataObject>;
			expect(events.length).toBeGreaterThan(0);

			// Check event structure
			const event = events[0];
			expect(event.stage).toBeDefined();
			expect(['request', 'response']).toContain(event.stage);
			expect(event.url).toBeDefined();
			expect(event.ts).toBeDefined();
		});
	});

	describe('POST Request', () => {
		it('should handle POST request with body', async () => {
			(mockExecuteFunctions.getNodeParameter as jest.Mock).mockImplementation(
				(parameterName: string, itemIndex: number, defaultValue?: any) => {
					const params: Record<string, any> = {
						url: 'https://api.example.com/v1/users',
						method: 'POST',
						qsJson: {},
						headersJson: {},
						bodyJson: { name: 'Test User', email: 'test@example.com' },
						sendPreauth: true,
						sendMain: true,
						redact: false,
						truncate: 10000,
					};
					return params[parameterName] ?? defaultValue;
				},
			);

			const result = await node.execute.call(mockExecuteFunctions as IExecuteFunctions);

			expect(result).toBeDefined();
			const json = result[0][0].json as IDataObject;
			expect(json.events).toBeDefined();
			expect(Array.isArray(json.events)).toBe(true);
		});
	});

	describe('Send Toggles', () => {
		it('should skip pre-auth when sendPreauth is false', async () => {
			(mockExecuteFunctions.getNodeParameter as jest.Mock).mockImplementation(
				(parameterName: string, itemIndex: number, defaultValue?: any) => {
					const params: Record<string, any> = {
						url: 'https://api.example.com/v1/users',
						method: 'GET',
						qsJson: {},
						headersJson: {},
						bodyJson: {},
						sendPreauth: false,
						sendMain: true,
						redact: false,
						truncate: 10000,
					};
					return params[parameterName] ?? defaultValue;
				},
			);

			const result = await node.execute.call(mockExecuteFunctions as IExecuteFunctions);

			const output = result[0][0];
			const events = output.json.events as Array<any>;
			const preAuthResponses = events.filter((e) => e.isPreAuth === true && e.stage === 'response');

			// Pre-auth should be captured but not sent
			preAuthResponses.forEach((event) => {
				expect(event.statusCode).toBe(0);
				expect(event.statusMessage).toBe('MOCKED-NOT-SENT');
			});
		});

		it('should skip main request when sendMain is false', async () => {
			(mockExecuteFunctions.getNodeParameter as jest.Mock).mockImplementation(
				(parameterName: string, itemIndex: number, defaultValue?: any) => {
					const params: Record<string, any> = {
						url: 'https://api.example.com/v1/users',
						method: 'GET',
						qsJson: {},
						headersJson: {},
						bodyJson: {},
						sendPreauth: true,
						sendMain: false,
						redact: false,
						truncate: 10000,
					};
					return params[parameterName] ?? defaultValue;
				},
			);

			const result = await node.execute.call(mockExecuteFunctions as IExecuteFunctions);

			const output = result[0][0];
			const events = output.json.events as Array<any>;
			const mainResponses = events.filter((e) => e.isPreAuth === false && e.stage === 'response');

			// Main request should be captured but not sent
			mainResponses.forEach((event) => {
				expect(event.statusCode).toBe(0);
				expect(event.statusMessage).toBe('MOCKED-NOT-SENT');
			});
		});
	});

	describe('Redaction', () => {
		it('should redact sensitive data when redact is true', async () => {
			(mockExecuteFunctions.getNodeParameter as jest.Mock).mockImplementation(
				(parameterName: string, itemIndex: number, defaultValue?: any) => {
					const params: Record<string, any> = {
						url: 'https://api.example.com/v1/users',
						method: 'GET',
						qsJson: {},
						headersJson: {},
						bodyJson: {},
						sendPreauth: true,
						sendMain: true,
						redact: true,
						truncate: 10000,
					};
					return params[parameterName] ?? defaultValue;
				},
			);

			const result = await node.execute.call(mockExecuteFunctions as IExecuteFunctions);

			const output = result[0][0];
			const events = output.json.events as Array<any>;

			// Check that Authorization headers are redacted
			events.forEach((event) => {
				if (event.headers?.Authorization) {
					expect(event.headers.Authorization).toBe('***REDACTED***');
				}
			});
		});
	});

	describe('Error Handling', () => {
		it('should capture errors and return timeline', async () => {
			// Mock httpRequestWithAuthentication to throw error
			(mockExecuteFunctions.helpers as any).httpRequestWithAuthentication = jest.fn(async () => {
				throw new Error('Network error');
			});

			const result = await node.execute.call(mockExecuteFunctions as IExecuteFunctions);

			expect(result).toBeDefined();
			expect(result[0][0].json.error).toBeDefined();
			expect(result[0][0].json.events).toBeDefined();
		});
	});

	describe('Multiple Items', () => {
		it('should process multiple input items', async () => {
			(mockExecuteFunctions.getInputData as jest.Mock).mockReturnValue([
				{ json: {}, binary: {} },
				{ json: {}, binary: {} },
			]);

			const result = await node.execute.call(mockExecuteFunctions as IExecuteFunctions);

			expect(result[0]).toHaveLength(2);
			const json0 = result[0][0].json as IDataObject;
			expect(json0.events).toBeDefined();
			expect(Array.isArray(json0.events)).toBe(true);
			const json1 = result[0][1].json as IDataObject;
			expect(json1.events).toBeDefined();
			expect(Array.isArray(json1.events)).toBe(true);
		});
	});
});
