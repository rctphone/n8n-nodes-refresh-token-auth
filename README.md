# n8n-nodes-refresh-token-auth

![n8n.io - Workflow Automation](https://raw.githubusercontent.com/n8n-io/n8n/master/assets/n8n-logo.png)

<p align="center">
This community node provides automatic refresh token authentication support for n8n workflows. It enables seamless integration with APIs that use JWT tokens and require periodic token refreshing.
</p>

<br>

## 📋 Table of Contents

- [Features](#-features)
- [Requirements](#-requirements)
- [Installation](#-installation)
- [Credentials Configuration](#-credentials-configuration)
- [How It Works](#-how-it-works)
- [Usage Example](#-usage-example)
- [Advanced Configuration](#-advanced-configuration)
- [Troubleshooting](#-troubleshooting)
- [Contributing](#-contributing)
- [License](#-license)

---

## ✨ Features

This community node provides a comprehensive solution for token-based authentication with automatic refresh capabilities:

- 🔐 **Bearer Token Authentication** - Automatic inclusion of access token in Authorization header
- 🔄 **Automatic Token Refresh** - Detects expired tokens and refreshes them automatically
- ⏰ **JWT Expiration Check** - Validates JWT token expiration dates with configurable leeway
- 🚨 **401 Error Handling** - Automatically refreshes token on authentication failures
- 🎛️ **Flexible Refresh Modes** - Choose when to refresh: Never, Always, On JWT Expiry, or On 401 Error
- ⚙️ **Customizable Field Names** - Configure field names for your specific API (supports dot notation)
- 🎯 **Token Testing** - Built-in credential testing to verify token validity
- 🔧 **Flexible Configuration** - Support for various token refresh mechanisms
- 📝 **Custom Request Configuration** - Configure custom headers, body, and query string parameters for refresh requests
- 🌐 **Common Request Template** - Apply shared headers and query params to all requests (refresh, test, and main)
- 📦 **Form-urlencoded Support** - Supports both JSON and form-urlencoded refresh requests

---

## 📌 Requirements

To use this community node, you need:

- **n8n** version **1.54.4** or higher
- An API that supports token-based authentication with refresh tokens
- Valid access token and refresh token from your API provider

---

## 🚀 Installation

### Option 1: Install via n8n Community Nodes (Recommended)

1. Open your n8n instance
2. Go to **Settings** → **Community Nodes**
3. Click **Install**
4. Enter: `n8n-nodes-refresh-token-auth`
5. Click **Install**
6. Restart n8n if required

### Option 2: Manual Installation

```bash
# Navigate to your n8n installation directory
cd ~/.n8n

# Install the package
npm install n8n-nodes-refresh-token-auth

# Restart n8n
```

### Option 3: Docker Installation

If you're using n8n with Docker, add the package to your installation:

```dockerfile
FROM n8nio/n8n:latest

USER root

# Install the community node
RUN cd /usr/local/lib/node_modules/n8n && \
    npm install n8n-nodes-refresh-token-auth

USER node
```

Or use Docker Compose:

```yaml
services:
  n8n:
    image: n8nio/n8n:latest
    environment:
      - N8N_COMMUNITY_PACKAGES_ENABLED=true
    volumes:
      - ~/.n8n:/home/node/.n8n
    command: /bin/sh -c "cd /usr/local/lib/node_modules/n8n && npm install n8n-nodes-refresh-token-auth && n8n start"
```

---

## 🔑 Credentials Configuration

### Basic Setup

1. In your n8n workflow, create a new credential
2. Select **Refresh Token Auth**
3. Fill in the required fields:

| Field                 | Description                            | Example                                   |
| --------------------- | -------------------------------------- | ----------------------------------------- |
| **Access Token**      | Your current access token (JWT)        | `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...` |
| **Refresh Token**     | Token used to obtain new access tokens | `your-refresh-token-here`                 |
| **Refresh Token URL** | API endpoint to refresh the token      | `https://api.example.com/auth/refresh`    |
| **Test URL**          | Endpoint to test token validity        | `https://api.example.com/user/profile`    |

### Advanced Options

Click on **Advanced Options** to customize the authentication behavior:

| Option                            | Default         | Description                                                                                             |
| --------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------- |
| **Access Token Field Name**       | `access_token`  | Field name in refresh response for new access token (supports dot notation, e.g., `data.token`)         |
| **Refresh Token Field Name**      | `refresh_token` | Field name in refresh response for new refresh token (supports dot notation, e.g., `data.refreshToken`) |
| **Authorization Header Prefix**   | `Bearer`        | Prefix for Authorization header (Bearer, Token, etc.)                                                   |
| **Refresh Request Configuration** | -               | JSON configuration for custom headers, body, and query string parameters in refresh requests            |
| **Common Request Template**       | -               | JSON template for headers and query params applied to ALL requests (refresh, test, and main)            |
| **Refresh Token Mode**            | `onJwtExpiry`   | When to trigger token refresh: Never, Always, On JWT Expiry, or On 401 Error                            |
| **JWT Expiry Leeway (seconds)**   | `60`            | Seconds before JWT expiration to trigger refresh (only for "On JWT Expiry" mode)                        |

### Refresh Request Configuration

The **Refresh Request Configuration** field allows you to customize the refresh token request with:

- **Custom Headers**: Add any headers required by your API (e.g., `User-Agent`, `X-API-Key`)
- **Custom Body Parameters**: Include additional body parameters (e.g., `grant_type`, `client_id`, `client_secret`)
- **Query String Parameters**: Add query parameters to the refresh URL

The refresh token location (header or body) is automatically determined based on whether the refresh token field name appears in the `headers` or `body` section of the configuration.

**Example Configuration:**

```json
{
	"headers": {
		"User-Agent": "MyApp/1.0",
		"X-API-Key": "your-api-key"
	},
	"body": {
		"grant_type": "refresh_token",
		"refresh_token": "refresh token here",
		"client_id": "client_id_here",
		"client_secret": "client_secret_here"
	},
	"qs": {
		"version": "v1"
	}
}
```

**Note**: The actual refresh token value will be automatically inserted based on the `Refresh Token Field Name` setting. If the field name appears in `headers`, the token will be sent in headers; if it appears in `body`, it will be sent in the body. If neither is specified, it defaults to the body.

### Common Request Template

The **Common Request Template** field allows you to define headers and query parameters that will be applied to **all** HTTP requests (refresh requests, test requests, and main requests). This is useful for:

- Device identification headers
- API version parameters
- User-Agent strings
- Any other headers or query params that should be consistent across all calls

**Example:**

```json
{
	"headers": {
		"User-Agent": "MyApp/2.0",
		"X-Device-ID": "device-12345"
	},
	"qs": {
		"api_version": "v2",
		"stage": "production"
	}
}
```

### Refresh Token Modes

The credential supports four different refresh modes:

| Mode                        | Description                                     | When to Use                                                       |
| --------------------------- | ----------------------------------------------- | ----------------------------------------------------------------- |
| **Never (Manual Only)**     | No automatic refresh                            | When you want to manage token refresh manually                    |
| **Always**                  | Refresh before every request                    | When tokens are short-lived or API requires fresh tokens          |
| **On JWT Expiry** (default) | Refresh when JWT exp claim indicates expiration | Most common scenario - efficient and automatic                    |
| **On 401 Error**            | Refresh only when API returns 401 Unauthorized  | When JWT validation isn't reliable or tokens don't have exp claim |

**JWT Expiry Leeway**: When using "On JWT Expiry" mode, you can configure how many seconds before the actual expiration the token should be refreshed. Default is 60 seconds, which provides a safety buffer to account for clock skew and network delays.

---

## 🔍 How It Works

### Authentication Flow

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Node makes API request with access token                 │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. Check if token is expired (JWT validation)               │
└─────────────────────────────────────────────────────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
┌──────────────┐                    ┌──────────────┐
│ Token Valid  │                    │ Token Expired│
└──────────────┘                    └──────────────┘
        │                                   │
        ▼                                   ▼
┌──────────────┐                    ┌──────────────┐
│ Make Request │                    │ Refresh Token│
└──────────────┘                    └──────────────┘
        │                                   │
        ▼                                   ▼
┌──────────────┐                    ┌──────────────┐
│ 200 Response │                    │ Update Token │
└──────────────┘                    └──────────────┘
        │                                   │
        │                                   ▼
        │                           ┌──────────────┐
        │                           │ Retry Request│
        │                           └──────────────┘
        │                                   │
        └───────────────┬───────────────────┘
                        ▼
                ┌──────────────┐
                │ Return Data  │
                └──────────────┘
```

### Error Handling

The credential automatically handles:

- **JWT Expiration**: Checks token expiration date before making requests
- **401 Unauthorized**: Detects authentication failures and triggers token refresh
- **Token Refresh**: Calls refresh endpoint and updates stored credentials
- **Retry Logic**: Automatically retries failed requests with new token

---

## 💡 Usage Example

### Example Workflow

Here's a simple workflow that uses the Refresh Token Auth credential:

1. Add the **Refresh Token Example** node to your workflow
2. Select your configured **Refresh Token Auth** credential
3. Configure the node:
   - **Operation**: Get Request
   - **Base URL**: `https://api.example.com`
   - **API Endpoint**: `/api/users`
4. Execute the workflow

The node will automatically:

- Add the Bearer token to the Authorization header
- Check if the token is expired
- Refresh the token if needed
- Make the API request
- Return the response data

### Example API Configurations

#### Example 1: Standard OAuth2 API

```
Access Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Refresh Token: refresh_abc123xyz
Refresh URL: https://api.example.com/oauth/token
Test URL: https://api.example.com/me

Advanced Options:
- Access Token Field Name: access_token
- Refresh Token Field Name: refresh_token
- Authorization Header Prefix: Bearer
```

#### Example 2: Custom Token API

```
Access Token: your-access-token
Refresh Token: your-refresh-token
Refresh URL: https://custom-api.com/auth/refresh
Test URL: https://custom-api.com/user/info

Advanced Options:
- Access Token Field Name: token
- Refresh Token Field Name: refreshToken
- Authorization Header Prefix: Token
- Refresh Request Configuration:
  {
    "body": {
      "grant_type": "refresh_token",
      "refreshToken": "refresh token here",
      "client_id": "your_client_id"
    }
  }
```

#### Example 3: API with Custom Headers and Query Parameters

```
Access Token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Refresh Token: refresh_abc123xyz
Refresh URL: https://api.example.com/v1/auth/refresh
Test URL: https://api.example.com/v1/user/profile

Advanced Options:
- Access Token Field Name: access_token
- Refresh Token Field Name: refresh_token
- Authorization Header Prefix: Bearer
- Refresh Request Configuration:
  {
    "headers": {
      "User-Agent": "MyApp/2.0",
      "X-API-Version": "v1"
    },
    "body": {
      "grant_type": "refresh_token",
      "refresh_token": "refresh token here",
      "client_id": "client_id_here",
      "client_secret": "client_secret_here"
    },
    "qs": {
      "format": "json"
    }
  }
```

---

## ⚙️ Advanced Configuration

### Custom Refresh Request Format

If your API requires a specific format for refresh requests, you can customize:

1. **Field Names**: Adjust to match your API's expected field names
2. **Request Location**: Automatically determined by refresh request configuration (header or body)
3. **Header Prefix**: Change "Bearer" to "Token" or custom prefix
4. **Custom Headers, Body, and Query Parameters**: Use Refresh Request Configuration JSON

### Refresh Request Configuration

The **Refresh Request Configuration** field provides full control over the refresh token request format. This is especially useful for APIs that require:

- Additional authentication headers (API keys, custom headers)
- OAuth2-style requests with `grant_type`, `client_id`, `client_secret`
- Query string parameters
- Custom request formats

#### How Refresh Token Location is Determined

The system automatically determines where to send the refresh token:

- If the refresh token field name appears in the `headers` section → token is sent in headers
- If the refresh token field name appears in the `body` section → token is sent in body
- If neither is specified → token defaults to body

#### Example: OAuth2 API Configuration

```javascript
// Your API expects this refresh request format:
POST https://api.example.com/oauth/token
Content-Type: application/json
User-Agent: MyApp/1.0

{
  "grant_type": "refresh_token",
  "refresh_token": "your-refresh-token",
  "client_id": "your-client-id",
  "client_secret": "your-client-secret"
}

// Configure the credential:
Refresh Token URL: https://api.example.com/oauth/token
Access Token Field Name: access_token
Refresh Token Field Name: refresh_token
Refresh Request Configuration:
{
  "headers": {
    "User-Agent": "MyApp/1.0"
  },
  "body": {
    "grant_type": "refresh_token",
    "refresh_token": "refresh token here",
    "client_id": "your-client-id",
    "client_secret": "your-client-secret"
  }
}
```

#### Example: API with Refresh Token in Header

```javascript
// Your API expects refresh token in Authorization header:
POST https://api.example.com/auth/refresh
Content-Type: application/json
Authorization: Bearer your-refresh-token
X-API-Key: your-api-key

{
  "grant_type": "refresh_token"
}

// Configure the credential:
Refresh Token URL: https://api.example.com/auth/refresh
Access Token Field Name: access_token
Refresh Token Field Name: refresh_token
Refresh Request Configuration:
{
  "headers": {
    "refresh_token": "refresh token here",
    "X-API-Key": "your-api-key"
  },
  "body": {
    "grant_type": "refresh_token"
  }
}
```

---

## 🔧 Troubleshooting

### Common Issues

#### Token Not Refreshing

**Problem**: Token expires but doesn't refresh automatically

**Solution**:

- Verify the Refresh Token URL is correct
- Check that your refresh token is still valid
- Ensure field names match your API's response format
- Verify the Refresh Request Configuration JSON is valid
- Check if your API requires specific headers or body parameters in the refresh request

#### 401 Errors Persisting

**Problem**: Getting 401 errors even after token refresh

**Solution**:

- Verify the Authorization Header Prefix is correct (Bearer vs Token)
- Check if your API requires additional headers
- Confirm the access token is being updated in the credential

#### Invalid JSON Response

**Problem**: Refresh request fails with parsing error

**Solution**:

- Check your API's refresh endpoint response format
- Update field names in Advanced Options to match response
- Verify the refresh endpoint returns JSON
- Ensure the Refresh Request Configuration JSON is properly formatted
- Check that all required fields (headers, body, qs) are correctly structured

#### Refresh Request Configuration Issues

**Problem**: Refresh request fails or doesn't match API requirements

**Solution**:

- Validate your Refresh Request Configuration JSON syntax
- Ensure the refresh token field name appears in either `headers` or `body` section
- Check that all required API parameters (client_id, client_secret, etc.) are included
- Verify custom headers match your API's requirements
- Test the refresh endpoint manually with the same configuration

### Debug Tips

1. **Test Credential**: Use the "Test" button in credential configuration
2. **Check Logs**: Enable n8n debug logs to see authentication flow
3. **API Documentation**: Refer to your API's authentication documentation
4. **Manual Test**: Use Postman/curl to verify refresh endpoint works

---

## 🤝 Contributing

Contributions are welcome! Here's how you can help:

- **Bug Reports**: Open an issue describing the problem
- **Feature Requests**: Suggest new features or improvements
- **Pull Requests**: Submit code improvements or bug fixes
- **Documentation**: Help improve or translate documentation

### Development Setup

```bash
# Clone the repository
git clone https://github.com/yourusername/n8n-nodes-refresh-token-auth.git
cd n8n-nodes-refresh-token-auth

# Install dependencies
pnpm install

# Build the project
pnpm build

# Watch for changes during development
pnpm dev
```

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details

---

## 🔗 Resources

- [n8n Documentation](https://docs.n8n.io/)
- [n8n Community Forum](https://community.n8n.io/)
- [Creating Custom Nodes](https://docs.n8n.io/integrations/creating-nodes/)
- [JWT Introduction](https://jwt.io/introduction)

---

## 📞 Support

If you need help:

1. Check the [Troubleshooting](#-troubleshooting) section
2. Search existing [Issues](https://github.com/yourusername/n8n-nodes-refresh-token-auth/issues)
3. Open a new issue if your problem isn't covered
4. Join the [n8n Community](https://community.n8n.io/) for discussions

---

<p align="center">
Made with ❤️ for the n8n community
</p>
