// Entry point for the n8n community node package
import type { ICredentialType, INodeType } from 'n8n-workflow';
import { RefreshToken } from './nodes/RefreshToken/RefreshToken.node';
import { RefreshTokenAuth } from './credentials/RefreshTokenAuth.credentials';

/**
 * Expose node and credential types for n8n runtime and tooling.
 */
export const nodeTypes: INodeType[] = [new RefreshToken()];
export const credentialTypes: ICredentialType[] = [new RefreshTokenAuth()];
