import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
// import { NodeConnectionType } from 'n8n-workflow';

export class RefreshToken implements INodeType {
	description: INodeTypeDescription = {
		documentationUrl: 'https://github.com/rctphone/n8n-nodes-refresh-token-auth',
		displayName: 'Refresh Token',
		name: 'refreshToken',
		group: ['transform'],
		version: 1,
		description: 'Simple pass-through node with RefreshTokenAuth credentials support',
		defaults: {
			name: 'Refresh Token',
		},
		inputs: ['main'],
		outputs: ['main'],
		properties: [],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		return [items];
	}
}
