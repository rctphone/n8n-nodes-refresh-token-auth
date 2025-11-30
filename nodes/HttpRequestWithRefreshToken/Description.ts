import type { INodeProperties } from 'n8n-workflow';

export const mainProperties: INodeProperties[] = [
	{
		displayName: 'Method',
		name: 'method',
		type: 'options',
		options: [
			{
				name: 'DELETE',
				value: 'DELETE',
			},
			{
				name: 'GET',
				value: 'GET',
			},
			{
				name: 'HEAD',
				value: 'HEAD',
			},
			{
				name: 'OPTIONS',
				value: 'OPTIONS',
			},
			{
				name: 'PATCH',
				value: 'PATCH',
			},
			{
				name: 'POST',
				value: 'POST',
			},
			{
				name: 'PUT',
				value: 'PUT',
			},
		],
		default: 'GET',
		description: 'The request method to use',
	},
	{
		displayName: 'URL',
		name: 'url',
		type: 'string',
		default: '',
		placeholder: 'http://example.com/index.html',
		description: 'The URL to make the request to',
		required: true,
	},
	{
		displayName: 'Authentication',
		name: 'authentication',
		noDataExpression: true,
		type: 'options',
		options: [
			{
				name: 'None',
				value: 'none',
			},
			{
				name: 'Predefined Credential Type',
				value: 'predefinedCredentialType',
				description:
					"We've already implemented auth for many services so that you don't have to set it up manually",
			},
			{
				name: 'Generic Credential Type',
				value: 'genericCredentialType',
				description: 'Fully customizable. Choose between basic, header, OAuth2, etc.',
			},
		],
		default: 'none',
	},
	{
		displayName: 'Credential Type',
		name: 'nodeCredentialType',
		type: 'credentialsSelect',
		noDataExpression: true,
		required: true,
		default: '',
		credentialTypes: ['extends:oAuth2Api', 'extends:oAuth1Api', 'has:authenticate'],
		displayOptions: {
			show: {
				authentication: ['predefinedCredentialType'],
			},
		},
	},

	{
		displayName: 'Send Query Parameters',
		name: 'sendQuery',
		type: 'boolean',
		default: false,
		noDataExpression: true,
		description: 'Whether the request has query params or not',
	},
	{
		displayName: 'Specify Query Parameters',
		name: 'specifyQuery',
		type: 'options',
		displayOptions: {
			show: {
				sendQuery: [true],
			},
		},
		options: [
			{
				name: 'Using Fields Below',
				value: 'keypair',
			},
			{
				name: 'Using JSON',
				value: 'json',
			},
		],
		default: 'keypair',
	},
	{
		displayName: 'Query Parameters',
		name: 'queryParameters',
		type: 'fixedCollection',
		displayOptions: {
			show: {
				sendQuery: [true],
				specifyQuery: ['keypair'],
			},
		},
		typeOptions: {
			multipleValues: true,
		},
		placeholder: 'Add Parameter',
		default: {
			parameters: [
				{
					name: '',
					value: '',
				},
			],
		},
		options: [
			{
				name: 'parameters',
				displayName: 'Parameter',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
					},
				],
			},
		],
	},
	{
		displayName: 'JSON',
		name: 'jsonQuery',
		type: 'json',
		displayOptions: {
			show: {
				sendQuery: [true],
				specifyQuery: ['json'],
			},
		},
		default: '',
	},
	{
		displayName: 'Send Headers',
		name: 'sendHeaders',
		type: 'boolean',
		default: false,
		noDataExpression: true,
		description: 'Whether the request has headers or not',
	},
	{
		displayName: 'Specify Headers',
		name: 'specifyHeaders',
		type: 'options',
		displayOptions: {
			show: {
				sendHeaders: [true],
			},
		},
		options: [
			{
				name: 'Using Fields Below',
				value: 'keypair',
			},
			{
				name: 'Using JSON',
				value: 'json',
			},
		],
		default: 'keypair',
	},
	{
		displayName: 'Header Parameters',
		name: 'headerParameters',
		type: 'fixedCollection',
		displayOptions: {
			show: {
				sendHeaders: [true],
				specifyHeaders: ['keypair'],
			},
		},
		typeOptions: {
			multipleValues: true,
		},
		placeholder: 'Add Parameter',
		default: {
			parameters: [
				{
					name: '',
					value: '',
				},
			],
		},
		options: [
			{
				name: 'parameters',
				displayName: 'Parameter',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
					},
				],
			},
		],
	},
	{
		displayName: 'JSON',
		name: 'jsonHeaders',
		type: 'json',
		displayOptions: {
			show: {
				sendHeaders: [true],
				specifyHeaders: ['json'],
			},
		},
		default: '',
	},
	{
		displayName: 'Send Body',
		name: 'sendBody',
		type: 'boolean',
		default: false,
		noDataExpression: true,
		description: 'Whether the request has a body or not',
	},
	{
		displayName: 'Body Content Type',
		name: 'contentType',
		type: 'options',
		displayOptions: {
			show: {
				sendBody: [true],
			},
		},
		options: [
			{
				name: 'Form Urlencoded',
				value: 'form-urlencoded',
			},
			{
				name: 'Form-Data',
				value: 'multipart-form-data',
			},
			{
				name: 'JSON',
				value: 'json',
			},
			{
				// eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased
				name: 'n8n Binary File',
				value: 'binaryData',
			},
			{
				name: 'Raw',
				value: 'raw',
			},
		],
		default: 'json',
		description: 'Content-Type to use to send body parameters',
	},
	{
		displayName: 'Specify Body',
		name: 'specifyBody',
		type: 'options',
		displayOptions: {
			show: {
				sendBody: [true],
				contentType: ['json'],
			},
		},
		options: [
			{
				name: 'Using Fields Below',
				value: 'keypair',
			},
			{
				name: 'Using JSON',
				value: 'json',
			},
		],
		default: 'keypair',
		// eslint-disable-next-line n8n-nodes-base/node-param-description-miscased-json
		description:
			'The body can be specified using explicit fields (<code>keypair</code>) or using a JavaScript object (<code>json</code>)',
	},
	{
		displayName: 'Body Parameters',
		name: 'bodyParameters',
		type: 'fixedCollection',
		displayOptions: {
			show: {
				sendBody: [true],
				contentType: ['json'],
				specifyBody: ['keypair'],
			},
		},
		typeOptions: {
			multipleValues: true,
		},
		placeholder: 'Add Parameter',
		default: {
			parameters: [
				{
					name: '',
					value: '',
				},
			],
		},
		options: [
			{
				name: 'parameters',
				displayName: 'Parameter',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description:
							'ID of the field to set. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Value of the field to set',
					},
				],
			},
		],
	},
	{
		displayName: 'JSON',
		name: 'jsonBody',
		type: 'json',
		displayOptions: {
			show: {
				sendBody: [true],
				contentType: ['json'],
				specifyBody: ['json'],
			},
		},
		default: '',
	},
	{
		displayName: 'Body Parameters',
		name: 'bodyParameters',
		type: 'fixedCollection',
		displayOptions: {
			show: {
				sendBody: [true],
				contentType: ['multipart-form-data'],
			},
		},
		typeOptions: {
			multipleValues: true,
		},
		placeholder: 'Add Parameter',
		default: {
			parameters: [
				{
					name: '',
					value: '',
				},
			],
		},
		options: [
			{
				name: 'parameters',
				displayName: 'Parameter',
				values: [
					{
						displayName: 'Parameter Type',
						name: 'parameterType',
						type: 'options',
						options: [
							{
								// eslint-disable-next-line n8n-nodes-base/node-param-display-name-miscased
								name: 'n8n Binary File',
								value: 'formBinaryData',
							},
							{
								name: 'Form Data',
								value: 'formData',
							},
						],
						default: 'formData',
					},
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description:
							'ID of the field to set. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						displayOptions: {
							show: {
								parameterType: ['formData'],
							},
						},
						default: '',
						description: 'Value of the field to set',
					},
					{
						displayName: 'Input Data Field Name',
						name: 'inputDataFieldName',
						type: 'string',
						displayOptions: {
							show: {
								parameterType: ['formBinaryData'],
							},
						},
						default: '',
						description:
							'The name of the incoming field containing the binary file data to be processed',
					},
				],
			},
		],
	},
	{
		displayName: 'Specify Body',
		name: 'specifyBody',
		type: 'options',
		displayOptions: {
			show: {
				sendBody: [true],
				contentType: ['form-urlencoded'],
			},
		},
		options: [
			{
				name: 'Using Fields Below',
				value: 'keypair',
			},
			{
				name: 'Using Single Field',
				value: 'string',
			},
		],
		default: 'keypair',
	},
	{
		displayName: 'Body Parameters',
		name: 'bodyParameters',
		type: 'fixedCollection',
		displayOptions: {
			show: {
				sendBody: [true],
				contentType: ['form-urlencoded'],
				specifyBody: ['keypair'],
			},
		},
		typeOptions: {
			multipleValues: true,
		},
		placeholder: 'Add Parameter',
		default: {
			parameters: [
				{
					name: '',
					value: '',
				},
			],
		},
		options: [
			{
				name: 'parameters',
				displayName: 'Parameter',
				values: [
					{
						displayName: 'Name',
						name: 'name',
						type: 'string',
						default: '',
						description:
							'ID of the field to set. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
					},
					{
						displayName: 'Value',
						name: 'value',
						type: 'string',
						default: '',
						description: 'Value of the field to set',
					},
				],
			},
		],
	},
	{
		displayName: 'Body',
		name: 'body',
		type: 'string',
		displayOptions: {
			show: {
				sendBody: [true],
				specifyBody: ['string'],
			},
		},
		default: '',
		placeholder: 'field1=value1&field2=value2',
	},
	{
		displayName: 'Input Data Field Name',
		name: 'inputDataFieldName',
		type: 'string',
		displayOptions: {
			show: {
				sendBody: [true],
				contentType: ['binaryData'],
			},
		},
		default: '',
		description: 'The name of the incoming field containing the binary file data to be processed',
	},
	{
		displayName: 'Content Type',
		name: 'rawContentType',
		type: 'string',
		displayOptions: {
			show: {
				sendBody: [true],
				contentType: ['raw'],
			},
		},
		default: '',
		placeholder: 'text/html',
	},
	{
		displayName: 'Body',
		name: 'body',
		type: 'string',
		displayOptions: {
			show: {
				sendBody: [true],
				contentType: ['raw'],
			},
		},
		default: '',
		placeholder: '',
	},
	{
		displayName: 'Options',
		name: 'options',
		type: 'collection',
		placeholder: 'Add option',
		default: {},
		options: [
			{
				displayName: 'Ignore SSL Issues (Insecure)',
				name: 'allowUnauthorizedCerts',
				type: 'boolean',
				noDataExpression: true,
				default: false,
				// eslint-disable-next-line n8n-nodes-base/node-param-description-wrong-for-ignore-ssl-issues
				description:
					'Whether to download the response even if SSL certificate validation is not possible',
			},
			{
				displayName: 'Array Format in Query Parameters',
				name: 'queryParameterArrays',
				type: 'options',
				displayOptions: {
					show: {
						'/sendQuery': [true],
					},
				},
				options: [
					{
						name: 'No Brackets',
						value: 'repeat',
						// eslint-disable-next-line n8n-nodes-base/node-param-description-lowercase-first-char
						description: 'e.g. foo=bar&foo=qux',
					},
					{
						name: 'Brackets Only',
						value: 'brackets',
						// eslint-disable-next-line n8n-nodes-base/node-param-description-lowercase-first-char
						description: 'e.g. foo[]=bar&foo[]=qux',
					},
					{
						name: 'Brackets with Indices',
						value: 'indices',
						// eslint-disable-next-line n8n-nodes-base/node-param-description-lowercase-first-char
						description: 'e.g. foo[0]=bar&foo[1]=qux',
					},
				],
				default: 'brackets',
			},
			{
				displayName: 'Lowercase Headers',
				name: 'lowercaseHeaders',
				type: 'boolean',
				default: true,
				description: 'Whether to lowercase header names',
			},
			{
				displayName: 'Redirects',
				name: 'redirect',
				placeholder: 'Add Redirect',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: { redirect: {} },
				options: [
					{
						displayName: 'Redirect',
						name: 'redirect',
						values: [
							{
								displayName: 'Follow Redirects',
								name: 'followRedirects',
								type: 'boolean',
								default: false,
								noDataExpression: true,
								description: 'Whether to follow all redirects',
							},
							{
								displayName: 'Max Redirects',
								name: 'maxRedirects',
								type: 'number',
								displayOptions: {
									show: {
										followRedirects: [true],
									},
								},
								default: 21,
								description: 'Max number of redirects to follow',
							},
						],
					},
				],
				displayOptions: {
					show: {
						'@version': [1, 2, 3],
					},
				},
			},
			{
				displayName: 'Redirects',
				name: 'redirect',
				placeholder: 'Add Redirect',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: {
					redirect: {},
				},
				options: [
					{
						displayName: 'Redirect',
						name: 'redirect',
						values: [
							{
								displayName: 'Follow Redirects',
								name: 'followRedirects',
								type: 'boolean',
								default: true,
								noDataExpression: true,
								description: 'Whether to follow all redirects',
							},
							{
								displayName: 'Max Redirects',
								name: 'maxRedirects',
								type: 'number',
								displayOptions: {
									show: {
										followRedirects: [true],
									},
								},
								default: 21,
								description: 'Max number of redirects to follow',
							},
						],
					},
				],
				displayOptions: {
					hide: {
						'@version': [1, 2, 3],
					},
				},
			},
			{
				displayName: 'Response',
				name: 'response',
				placeholder: 'Add response',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: false,
				},
				default: {
					response: {},
				},
				options: [
					{
						displayName: 'Response',
						name: 'response',
						values: [
							{
								displayName: 'Include Response Headers and Status',
								name: 'fullResponse',
								type: 'boolean',
								default: false,
								description:
									'Whether to return the full response (headers and response status code) data instead of only the body',
							},
							{
								displayName: 'Never Error',
								name: 'neverError',
								type: 'boolean',
								default: false,
								description: 'Whether to succeeds also when status code is not 2xx',
							},
							{
								displayName: 'Response Format',
								name: 'responseFormat',
								type: 'options',
								noDataExpression: true,
								options: [
									{
										name: 'Autodetect',
										value: 'autodetect',
									},
									{
										name: 'File',
										value: 'file',
									},
									{
										name: 'JSON',
										value: 'json',
									},
									{
										name: 'Text',
										value: 'text',
									},
								],
								default: 'autodetect',
								description: 'The format in which the data gets returned from the URL',
							},
							{
								displayName: 'Put Output in Field',
								name: 'outputPropertyName',
								type: 'string',
								default: 'data',
								required: true,
								displayOptions: {
									show: {
										responseFormat: ['file', 'text'],
									},
								},
								description:
									'Name of the binary property to which to write the data of the read file',
							},
						],
					},
				],
			},

			{
				displayName: 'Proxy',
				name: 'proxy',
				type: 'string',
				default: '',
				placeholder: 'e.g. http://myproxy:3128',
				description: 'HTTP proxy to use',
			},
			{
				displayName: 'Timeout',
				name: 'timeout',
				type: 'number',
				typeOptions: {
					minValue: 1,
				},
				default: 10000,
				description:
					'Time in ms to wait for the server to send response headers (and start the response body) before aborting the request',
			},
		],
	},
	{
		displayName:
			"You can view the raw requests this node makes in your browser's developer console",
		name: 'infoMessage',
		type: 'notice',
		default: '',
	},
];
