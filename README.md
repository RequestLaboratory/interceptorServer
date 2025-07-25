# API Proxy Server

A Node.js proxy server that intercepts HTTP requests and logs them to Supabase. Built with Express and http-proxy-middleware.

## Features

- 🔄 **HTTP Request Proxying** - Routes requests to target APIs
- 📊 **Request/Response Logging** - Captures and stores all traffic in Supabase
- 🔐 **Security** - Headers sanitization and request validation
- 🌐 **CORS Support** - Handles cross-origin requests
- 📈 **Structured Logging** - JSON logs with request IDs and timing
- 🚀 **Easy Setup** - Simple configuration with environment variables

## Installation

```bash
cd api-proxy-server
npm install
```

## Configuration

Create a `.env` file in the project root:

```env
PORT=3000
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-supabase-anon-key
```

## Usage

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

## API Endpoints

### Status

- `GET /status` - Server status and version

### Interceptors Management

- `GET /api/interceptors` - List all interceptors
- `POST /api/interceptors` - Create new interceptor
- `DELETE /api/interceptors/:id` - Delete interceptor
- `GET /api/interceptors/:id/logs` - Get logs for interceptor

### Proxy Requests

- `/{uniqueCode}/*` - Proxy requests to target API

## Creating an Interceptor

```bash
curl -X POST http://localhost:3000/api/interceptors \
  -H "Content-Type: application/json" \
  -d '{
    "name": "My API",
    "baseUrl": "https://api.example.com"
  }'
```

Response:

```json
{
  "id": "abc123",
  "name": "My API",
  "base_url": "https://api.example.com",
  "created_at": "2024-01-01T00:00:00.000Z",
  "is_active": true,
  "user_id": "system"
}
```

## Using the Proxy

Once you have an interceptor, you can proxy requests:

```bash
# Original request to: https://api.example.com/users
# Proxy request to: http://localhost:3000/abc123/users

curl http://localhost:3000/abc123/users
```

The server will:

1. Look up the interceptor with ID `abc123`
2. Forward the request to `https://api.example.com/users`
3. Log the request and response to Supabase
4. Return the response to the client

## Database Schema

### Interceptors Table

```sql
CREATE TABLE interceptors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  user_id TEXT
);
```

### Logs Table

```sql
CREATE TABLE logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  interceptor_id TEXT REFERENCES interceptors(id),
  original_url TEXT,
  proxy_url TEXT,
  method TEXT,
  headers JSONB,
  body TEXT,
  response_status INTEGER,
  response_headers JSONB,
  response_body TEXT,
  timestamp TIMESTAMP DEFAULT NOW(),
  duration INTEGER
);
```

## Security Features

- **Header Sanitization** - Removes sensitive headers (authorization, cookies, etc.)
- **Request Size Limits** - 10MB maximum request size
- **Content Type Validation** - Only logs supported content types
- **CORS Protection** - Configurable CORS headers
- **Helmet Security** - Security headers middleware

## Logging

The server logs:

- Request method, URL, headers, and body
- Response status, headers, and body
- Request duration
- Structured JSON logs with request IDs

Sensitive data (authorization headers, cookies) is automatically filtered out.

## Development

### Project Structure

```
api-proxy-server/
├── server.js          # Main server file
├── package.json       # Dependencies and scripts
├── .env              # Environment variables
└── README.md         # This file
```

### Dependencies

- `express` - Web framework
- `http-proxy-middleware` - HTTP proxying
- `@supabase/supabase-js` - Database client
- `cors` - CORS middleware
- `helmet` - Security headers
- `morgan` - HTTP request logging
- `dotenv` - Environment variables
- `nodemon` - Development server (dev dependency)

## License

ISC
