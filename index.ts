// Entry point for the n8n community node package
import type { ICredentialType, INodeType } from 'n8n-workflow';
import { DebugRefreshToken } from './nodes/DebugRefreshToken/DebugRefreshToken.node';
import { HttpRequestWithRefreshToken } from './nodes/HttpRequestWithRefreshToken/HttpRequestWithRefreshToken.node';
import { RefreshTokenAuth } from './credentials/RefreshTokenAuth.credentials';

/**
 * Expose node and credential types for n8n runtime and tooling.
 */
export const nodeTypes: INodeType[] = [new DebugRefreshToken(), new HttpRequestWithRefreshToken()];
export const credentialTypes: ICredentialType[] = [new RefreshTokenAuth()];
