import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	IHttpRequestOptions,
	IHttpRequestMethods,
	IDataObject,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

import { mainProperties } from './Description';

const CREDENTIALS_NAME = 'refreshTokenAuth';

/**
 * Helper: parse JSON string or return object as-is
 */
function parseJsonParameter(value: string | IDataObject): IDataObject {
	if (typeof value === 'string') {
		if (!value.trim()) return {};
		return JSON.parse(value) as IDataObject;
	}
	return value;
}

/**
 * HTTP Request node with RefreshTokenAuth credentials support.
 * Automatically handles token refresh through preAuthentication mechanism.
 */
export class HttpRequestWithRefreshToken implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'HTTP Request (Refresh Token Auth)',
		name: 'httpRequestWithRefreshToken',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["method"] + ": " + $parameter["url"]}}',
		description:
			'Makes an HTTP request using RefreshTokenAuth credentials with automatic token refresh.',
		icon: 'file:refresh-token-auth.svg',
		defaults: {
			name: 'HTTP Request (Refresh Token Auth)',
		},
		inputs: ['main'],
		outputs: ['main'],
		credentials: [
			{
				name: CREDENTIALS_NAME,
				required: true,
			},
		],
		properties: mainProperties,
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnItems: INodeExecutionData[] = [];

		for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
			try {
				// Get basic request parameters
				const url = this.getNodeParameter('url', itemIndex) as string;
				const method = this.getNodeParameter('method', itemIndex) as IHttpRequestMethods;

				// Validate URL
				if (!url) {
					throw new NodeOperationError(this.getNode(), 'URL is required', { itemIndex });
				}
				if (!url.startsWith('http://') && !url.startsWith('https://')) {
					throw new NodeOperationError(
						this.getNode(),
						`Invalid URL: ${url}. URL must start with "http://" or "https://".`,
						{ itemIndex },
					);
				}

				// Build request options
				const requestOptions: IHttpRequestOptions = {
					method,
					url,
					returnFullResponse: true,
				};

				// Process query parameters
				const sendQuery = this.getNodeParameter('sendQuery', itemIndex, false) as boolean;
				if (sendQuery) {
					const specifyQuery = this.getNodeParameter(
						'specifyQuery',
						itemIndex,
						'keypair',
					) as string;
					if (specifyQuery === 'keypair') {
						const queryParameters = this.getNodeParameter(
							'queryParameters.parameters',
							itemIndex,
							[],
						) as Array<{ name: string; value: string }>;

						if (queryParameters.length > 0) {
							requestOptions.qs = {};
							for (const param of queryParameters) {
								if (param.name) {
									requestOptions.qs[param.name] = param.value;
								}
							}
						}
					} else if (specifyQuery === 'json') {
						const jsonQuery = this.getNodeParameter('jsonQuery', itemIndex, '') as string;
						requestOptions.qs = parseJsonParameter(jsonQuery);
					}
				}

				// Process headers
				const sendHeaders = this.getNodeParameter('sendHeaders', itemIndex, false) as boolean;
				if (sendHeaders) {
					const specifyHeaders = this.getNodeParameter(
						'specifyHeaders',
						itemIndex,
						'keypair',
					) as string;
					if (specifyHeaders === 'keypair') {
						const headerParameters = this.getNodeParameter(
							'headerParameters.parameters',
							itemIndex,
							[],
						) as Array<{ name: string; value: string }>;

						if (headerParameters.length > 0) {
							requestOptions.headers = {};
							for (const param of headerParameters) {
								if (param.name) {
									requestOptions.headers[param.name.toLowerCase()] = param.value;
								}
							}
						}
					} else if (specifyHeaders === 'json') {
						const jsonHeaders = this.getNodeParameter('jsonHeaders', itemIndex, '') as string;
						const parsedHeaders = parseJsonParameter(jsonHeaders);
						// Lowercase header keys
						requestOptions.headers = {};
						for (const [key, value] of Object.entries(parsedHeaders)) {
							requestOptions.headers[key.toLowerCase()] = value as string;
						}
					}
				}

				// Process body
				const sendBody = this.getNodeParameter('sendBody', itemIndex, false) as boolean;
				if (sendBody && ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
					const contentType = this.getNodeParameter('contentType', itemIndex, 'json') as string;

					if (contentType === 'json') {
						const specifyBody = this.getNodeParameter(
							'specifyBody',
							itemIndex,
							'keypair',
						) as string;
						if (specifyBody === 'keypair') {
							const bodyParameters = this.getNodeParameter(
								'bodyParameters.parameters',
								itemIndex,
								[],
							) as Array<{ name: string; value: string }>;

							if (bodyParameters.length > 0) {
								requestOptions.body = {};
								for (const param of bodyParameters) {
									if (param.name) {
										(requestOptions.body as IDataObject)[param.name] = param.value;
									}
								}
							}
						} else if (specifyBody === 'json') {
							const jsonBody = this.getNodeParameter('jsonBody', itemIndex, '') as string;
							requestOptions.body = parseJsonParameter(jsonBody);
						}
						requestOptions.headers = {
							...requestOptions.headers,
							'content-type': 'application/json',
						};
					} else if (contentType === 'form-urlencoded') {
						const specifyBody = this.getNodeParameter(
							'specifyBody',
							itemIndex,
							'keypair',
						) as string;
						if (specifyBody === 'keypair') {
							const bodyParameters = this.getNodeParameter(
								'bodyParameters.parameters',
								itemIndex,
								[],
							) as Array<{ name: string; value: string }>;

							const formData: IDataObject = {};
							for (const param of bodyParameters) {
								if (param.name) {
									formData[param.name] = param.value;
								}
							}
							requestOptions.body = new URLSearchParams(
								formData as Record<string, string>,
							).toString();
						} else if (specifyBody === 'string') {
							requestOptions.body = this.getNodeParameter('body', itemIndex, '') as string;
						}
						requestOptions.headers = {
							...requestOptions.headers,
							'content-type': 'application/x-www-form-urlencoded',
						};
					} else if (contentType === 'multipart-form-data') {
						const bodyParameters = this.getNodeParameter(
							'bodyParameters.parameters',
							itemIndex,
							[],
						) as Array<{
							name: string;
							value: string;
							parameterType?: string;
							inputDataFieldName?: string;
						}>;

						const formData: IDataObject = {};
						for (const param of bodyParameters) {
							if (param.name) {
								if (param.parameterType === 'formBinaryData' && param.inputDataFieldName) {
									const binaryData = this.helpers.assertBinaryData(
										itemIndex,
										param.inputDataFieldName,
									);
									const itemBinaryData = items[itemIndex].binary![param.inputDataFieldName];
									let uploadData: Buffer;
									if (itemBinaryData.id) {
										const stream = await this.helpers.getBinaryStream(itemBinaryData.id);
										const chunks: Buffer[] = [];
										for await (const chunk of stream) {
											chunks.push(Buffer.from(chunk));
										}
										uploadData = Buffer.concat(chunks);
									} else {
										uploadData = Buffer.from(itemBinaryData.data, 'base64');
									}
									formData[param.name] = {
										value: uploadData,
										options: {
											filename: binaryData.fileName,
											contentType: binaryData.mimeType,
										},
									};
								} else {
									formData[param.name] = param.value;
								}
							}
						}
						// Note: For multipart, n8n handles content-type automatically
						(requestOptions as any).formData = formData;
					} else if (contentType === 'raw') {
						const rawContentType = this.getNodeParameter(
							'rawContentType',
							itemIndex,
							'text/plain',
						) as string;
						requestOptions.body = this.getNodeParameter('body', itemIndex, '') as string;
						requestOptions.headers = { ...requestOptions.headers, 'content-type': rawContentType };
					} else if (contentType === 'binaryData') {
						const inputDataFieldName = this.getNodeParameter(
							'inputDataFieldName',
							itemIndex,
						) as string;
						const itemBinaryData = this.helpers.assertBinaryData(itemIndex, inputDataFieldName);

						let uploadData: Buffer;
						if (itemBinaryData.id) {
							const stream = await this.helpers.getBinaryStream(itemBinaryData.id);
							const chunks: Buffer[] = [];
							for await (const chunk of stream) {
								chunks.push(Buffer.from(chunk));
							}
							uploadData = Buffer.concat(chunks);
						} else {
							uploadData = Buffer.from(itemBinaryData.data, 'base64');
						}

						requestOptions.body = uploadData;
						requestOptions.headers = {
							...requestOptions.headers,
							'content-type': itemBinaryData.mimeType ?? 'application/octet-stream',
							'content-length': uploadData.length.toString(),
						};
					}
				}

				// Apply options
				const options = this.getNodeParameter('options', itemIndex, {}) as IDataObject;

				if (options.allowUnauthorizedCerts) {
					requestOptions.skipSslCertificateValidation = true;
				}

				if (options.timeout) {
					requestOptions.timeout = options.timeout as number;
				}

				if (options.proxy) {
					requestOptions.proxy = { host: options.proxy as string, port: 80 };
				}

				// Handle redirects
				const redirect = options.redirect as
					| { redirect?: { followRedirects?: boolean; maxRedirects?: number } }
					| undefined;
				if (redirect?.redirect?.followRedirects === false) {
					requestOptions.ignoreHttpStatusErrors = true;
				}

				// Execute request with authentication
				const response = await this.helpers.httpRequestWithAuthentication.call(
					this,
					CREDENTIALS_NAME,
					requestOptions,
				);

				// Process response
				const responseOptions = options.response as
					| {
							response?: {
								fullResponse?: boolean;
								responseFormat?: string;
								outputPropertyName?: string;
								neverError?: boolean;
							};
					  }
					| undefined;
				const fullResponse = responseOptions?.response?.fullResponse ?? false;
				const responseFormat = responseOptions?.response?.responseFormat ?? 'autodetect';
				const outputPropertyName = responseOptions?.response?.outputPropertyName ?? 'data';

				let responseBody: any;
				let responseHeaders: IDataObject = {};
				let statusCode: number | undefined;
				let statusMessage: string | undefined;

				// Handle full response object
				if (typeof response === 'object' && response !== null && 'body' in response) {
					responseBody = (response as any).body;
					responseHeaders = (response as any).headers ?? {};
					statusCode = (response as any).statusCode;
					statusMessage = (response as any).statusMessage;
				} else {
					responseBody = response;
				}

				// Format output based on settings
				if (fullResponse) {
					returnItems.push({
						json: {
							body: responseBody,
							headers: responseHeaders,
							statusCode,
							statusMessage,
						},
						pairedItem: { item: itemIndex },
					});
				} else if (responseFormat === 'file' || responseFormat === 'text') {
					const textValue =
						typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody);
					returnItems.push({
						json: { [outputPropertyName]: textValue },
						pairedItem: { item: itemIndex },
					});
				} else {
					// JSON format (default)
					if (Array.isArray(responseBody)) {
						for (const item of responseBody) {
							returnItems.push({
								json: item,
								pairedItem: { item: itemIndex },
							});
						}
					} else if (typeof responseBody === 'object' && responseBody !== null) {
						returnItems.push({
							json: responseBody,
							pairedItem: { item: itemIndex },
						});
					} else {
						returnItems.push({
							json: { data: responseBody },
							pairedItem: { item: itemIndex },
						});
					}
				}
			} catch (error) {
				if (!this.continueOnFail()) {
					throw error;
				}
				returnItems.push({
					json: { error: (error as Error).message },
					pairedItem: { item: itemIndex },
				});
			}
		}

		return [returnItems];
	}
}
