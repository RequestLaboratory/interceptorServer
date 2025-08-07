# Interceptor Server

A proxy server that intercepts and logs HTTP requests through configurable interceptors.

## Features

- Proxy requests through interceptors
- Request/response logging
- REST API for managing interceptors
- CORS support
- Supabase integration for data storage

## Local Development

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create a `.env` file with your Supabase credentials:

   ```
   SUPABASE_URL=https://opgwkalkqxudvkqxvfsc.supabase.co
   SUPABASE_ANON_KEY=your_supabase_anon_key_here
   PORT=3004
   ```

3. Start the server:
   ```bash
   npm start
   ```

## Deployment (Render)

### Environment Variables

Set these environment variables in your Render dashboard:

- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_ANON_KEY`: Your Supabase anonymous key
- `PORT`: Port number (Render will set this automatically)

### Build Configuration

- **Build Command**: `npm install`
- **Start Command**: `npm start`

## API Endpoints

- `GET /status` - Server status
- `GET /api/interceptors` - List all interceptors
- `POST /api/interceptors` - Create new interceptor
- `DELETE /api/interceptors/:id` - Delete interceptor
- `GET /api/interceptors/:id/logs` - Get logs for interceptor

## Proxy Usage

Requests are proxied through interceptors using the format:

```
http://your-domain.com/{interceptor-id}/path
```

Example:

```
http://localhost:3004/abc123/posts/1
```

This would proxy to the base URL of interceptor `abc123` with the path `/posts/1`.
