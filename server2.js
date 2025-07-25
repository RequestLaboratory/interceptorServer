const express = require('express');
const httpProxy = require('http-proxy');
const { createClient } = require('@supabase/supabase-js');
const helmet = require('helmet');
const morgan = require('morgan');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3004;

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'https://opgwkalkqxudvkqxvfsc.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wZ3drYWxrcXh1ZHZrcXh2ZnNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk1ODI3MjYsImV4cCI6MjA2NTE1ODcyNn0.JQEhK0Iub0e9ZAhO6H0BgzQXWa4S4MUml0fXkwyYN3E';
const supabase = createClient(supabaseUrl, supabaseKey);

// Constants
const MAX_REQUEST_SIZE = 10 * 1024 * 1024; // 10MB
const RATE_LIMIT_REQUESTS = 100;
const RATE_LIMIT_WINDOW = 60 * 1000;
const LOGGABLE_CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'text/',
  'application/x-www-form-urlencoded'
];
const SENSITIVE_HEADERS = [
  'authorization', 'cookie', 'x-api-key', 'x-auth-token', 'cf-connecting-ip'
];
const ALLOWED_FORWARD_HEADERS = [
  'content-type', 'authorization', 'user-agent', 'accept', 'accept-language',
  'cache-control', 'x-requested-with', 'x-api-key', 'x-auth-token'
];
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS, CONNECT',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, Upgrade, Connection, X-Requested-With, Accept, Accept-Language, Cache-Control, X-API-Key, X-Auth-Token, X-CSRF-Token, X-Forwarded-For, X-Forwarded-Proto, X-Real-IP, User-Agent, Origin, Referer',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'false',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};
const GLOBAL_ACCESS = 1;
const isAPI = process.env.API_MODE === '0' ? 0 : 1;

// Rate limiting
const rateLimitMap = new Map();
function checkRateLimit(key) {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW;
  for (const [k, v] of rateLimitMap) {
    if (v.timestamp < windowStart) rateLimitMap.delete(k);
  }
  const current = rateLimitMap.get(key);
  if (!current) {
    rateLimitMap.set(key, { count: 1, timestamp: now });
    return true;
  }
  if (current.timestamp < windowStart) {
    rateLimitMap.set(key, { count: 1, timestamp: now });
    return true;
  }
  if (current.count >= RATE_LIMIT_REQUESTS) return false;
  current.count++;
  return true;
}

// Helpers
function handleCors(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).set(corsHeaders).end();
    return true;
  }
  return false;
}
function addCorsHeaders(res, req) {
  Object.entries(corsHeaders).forEach(([k, v]) => res.header(k, v));
}
function sanitizeHeaders(headers) {
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_HEADERS.includes(key.toLowerCase())) sanitized[key] = value;
  }
  return sanitized;
}
function createForwardHeaders(requestHeaders) {
  const forwardHeaders = {};
  for (const [key, value] of Object.entries(requestHeaders)) {
    if (ALLOWED_FORWARD_HEADERS.includes(key.toLowerCase())) forwardHeaders[key] = value;
  }
  return forwardHeaders;
}
function shouldLogBody(contentType) {
  if (!contentType) return false;
  return LOGGABLE_CONTENT_TYPES.some(type => contentType.includes(type));
}
function createErrorResponse(message, status = 500, error = null) {
  const errorData = {
    error: status >= 500 ? 'Internal Server Error' : 'Client Error',
    message,
    timestamp: new Date().toISOString(),
    requestId: crypto.randomUUID()
  };
  if (error && status >= 500) errorData.details = error.message;
  return errorData;
}
function generateUniqueCode() {
  return Math.random().toString(36).substring(2, 8);
}

// Express middleware
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Comprehensive CORS middleware
app.use((req, res, next) => {
  // Always set CORS headers
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS, CONNECT');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, apikey, Upgrade, Connection, X-Requested-With, Accept, Accept-Language, Cache-Control, X-API-Key, X-Auth-Token, X-CSRF-Token, X-Forwarded-For, X-Forwarded-Proto, X-Real-IP, User-Agent, Origin, Referer');
  res.header('Access-Control-Max-Age', '86400');
  res.header('Access-Control-Allow-Credentials', 'false');
  
  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  next();
});

// Proxy
const proxy = httpProxy.createProxyServer();
proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err);
  if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Proxy error', message: err.message }));
});

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    mode: isAPI === 1 ? 'api' : 'sse',
    globalAccess: GLOBAL_ACCESS === 1,
    timestamp: new Date().toISOString()
  });
});

// SSE endpoint (stub)
app.get('/events', (req, res) => {
  if (isAPI === 1) return res.status(400).json({ error: 'SSE not available in API mode' });
  
  // Set CORS headers for SSE
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.write('retry: 1000\n');
  res.write('data: {"type":"connected"}\n\n');
  const heartbeat = setInterval(() => res.write('data: {"type":"heartbeat"}\n\n'), 15000);
  req.on('close', () => clearInterval(heartbeat));
});

// Interceptors API
app.get('/api/interceptors', async (req, res) => {
  try {
    if (GLOBAL_ACCESS === 1) {
      const { data, error } = await supabase.from('interceptors').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return res.json(data);
    }
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const sessionId = authHeader.replace('Bearer ', '');
    const { data: session, error: sessionError } = await supabase.from('sessions').select('*').eq('id', sessionId).single();
    if (sessionError || !session) return res.status(401).json({ error: 'Unauthorized' });
    if (new Date(session.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired' });
    const { data, error } = await supabase.from('interceptors').select('*').eq('user_id', session.user_id).order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json(createErrorResponse('Database error', 500, error));
  }
});

app.post('/api/interceptors', async (req, res) => {
  try {
    if (GLOBAL_ACCESS === 1) {
      const uniqueCode = generateUniqueCode();
      const interceptor = {
        id: uniqueCode,
        name: req.body.name,
        base_url: req.body.baseUrl,
        created_at: new Date().toISOString(),
        is_active: true,
        user_id: 'system'
      };
      const { data, error } = await supabase.from('interceptors').insert(interceptor).select().single();
      if (error) throw error;
      return res.json(data);
    }
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const sessionId = authHeader.replace('Bearer ', '');
    const { data: session, error: sessionError } = await supabase.from('sessions').select('*').eq('id', sessionId).single();
    if (sessionError || !session) return res.status(401).json({ error: 'Unauthorized' });
    if (new Date(session.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired' });
    const uniqueCode = generateUniqueCode();
    const interceptor = {
      id: uniqueCode,
      name: req.body.name,
      base_url: req.body.baseUrl,
      created_at: new Date().toISOString(),
      is_active: true,
      user_id: session.user_id
    };
    const { data, error } = await supabase.from('interceptors').insert(interceptor).select().single();
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json(createErrorResponse('Database error', 500, error));
  }
});

app.delete('/api/interceptors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (GLOBAL_ACCESS === 1) {
      const { error } = await supabase.from('interceptors').delete().eq('id', id);
      if (error) throw error;
      return res.status(204).end();
    }
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const sessionId = authHeader.replace('Bearer ', '');
    const { data: session, error: sessionError } = await supabase.from('sessions').select('*').eq('id', sessionId).single();
    if (sessionError || !session) return res.status(401).json({ error: 'Unauthorized' });
    if (new Date(session.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired' });
    const { data: interceptors, error: selectError } = await supabase.from('interceptors').select('*').eq('id', id).eq('user_id', session.user_id);
    if (selectError) throw selectError;
    if (!interceptors || interceptors.length === 0) return res.status(404).json({ error: 'Not found' });
    const { error } = await supabase.from('interceptors').delete().eq('id', id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) {
    res.status(500).json(createErrorResponse('Database error', 500, error));
  }
});

app.get('/api/interceptors/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    if (GLOBAL_ACCESS === 1) {
      const { data, error } = await supabase.from('logs').select('*').eq('interceptor_id', id).order('timestamp', { ascending: false }).range(offset, offset + limit - 1);
      if (error) throw error;
      return res.json(data);
    }
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });
    const sessionId = authHeader.replace('Bearer ', '');
    const { data: session, error: sessionError } = await supabase.from('sessions').select('*').eq('id', sessionId).single();
    if (sessionError || !session) return res.status(401).json({ error: 'Unauthorized' });
    if (new Date(session.expires_at) < new Date()) return res.status(401).json({ error: 'Session expired' });
    const { data: interceptors, error: selectError } = await supabase.from('interceptors').select('*').eq('id', id).eq('user_id', session.user_id);
    if (selectError) throw selectError;
    if (!interceptors || interceptors.length === 0) return res.status(404).json({ error: 'Not found' });
    const { data, error } = await supabase.from('logs').select('*').eq('interceptor_id', id).order('timestamp', { ascending: false }).range(offset, offset + limit - 1);
    if (error) throw error;
    res.json(data);
  } catch (error) {
    res.status(500).json(createErrorResponse('Database error', 500, error));
  }
});

// Main proxy route
app.all('/:uniqueCode/:path(*)', async (req, res) => {
  const { uniqueCode } = req.params;
  const startTime = Date.now();
  try {
    // Rate limiting
    const clientIP = req.ip || req.connection.remoteAddress;
    const rateLimitKey = `global:${clientIP}`;
    if (!checkRateLimit(rateLimitKey)) return res.status(429).json(createErrorResponse('Rate limit exceeded', 429));
    // Validate request size
    const contentLength = parseInt(req.headers['content-length'] || '0');
    if (contentLength > MAX_REQUEST_SIZE) return res.status(413).json(createErrorResponse('Request too large', 413));
    // Validate content type
    const contentType = req.headers['content-type'];
    if (contentType && !shouldLogBody(contentType)) return res.status(415).json(createErrorResponse('Unsupported content type', 415));
    // Get interceptor
    const { data: interceptor, error } = await supabase.from('interceptors').select('*').eq('id', uniqueCode).eq('is_active', true).single();
    if (error || !interceptor) return res.status(404).json(createErrorResponse('Interceptor not found', 404));
    // Build target URL
    const targetPath = req.originalUrl.replace(`/${uniqueCode}`, '');
    const targetUrl = interceptor.base_url.replace(/\/$/, '') + targetPath;
    // Prepare headers
    const forwardHeaders = createForwardHeaders(req.headers);
    forwardHeaders.host = new URL(interceptor.base_url).host;
    forwardHeaders['x-forwarded-for'] = clientIP;
    forwardHeaders['x-forwarded-proto'] = req.protocol;
    forwardHeaders['x-forwarded-host'] = req.get('host') || 'unknown';
    // Capture response body for logging
    let responseBody = Buffer.alloc(0);
    const originalWrite = res.write;
    const originalEnd = res.end;
    res.write = function(chunk, ...args) {
      if (chunk) responseBody = Buffer.concat([responseBody, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      return originalWrite.apply(res, [chunk, ...args]);
    };
    res.end = function(chunk, ...args) {
      if (chunk) responseBody = Buffer.concat([responseBody, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
      const duration = Date.now() - startTime;
      const log = {
        id: crypto.randomUUID(),
        interceptor_id: interceptor.id,
        original_url: targetUrl,
        proxy_url: req.originalUrl,
        method: req.method,
        headers: JSON.stringify(sanitizeHeaders(req.headers)),
        body: shouldLogBody(contentType) ? JSON.stringify(req.body) : '[Not logged]',
        response_status: res.statusCode,
        response_headers: JSON.stringify(sanitizeHeaders(res.getHeaders())),
        response_body: responseBody.toString('utf8'),
        timestamp: new Date().toISOString(),
        duration
      };
      storeLog(log).catch(e => console.error('Error storing log:', e));
      return originalEnd.apply(res, [chunk, ...args]);
    };
    // Proxy
    proxy.web(req, res, {
      target: interceptor.base_url,
      changeOrigin: true,
      selfHandleResponse: false,
      headers: forwardHeaders
    });
  } catch (error) {
    res.status(500).json(createErrorResponse('Proxy error', 500, error));
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json(createErrorResponse('Internal server error', 500, err));
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json(createErrorResponse('Not found', 404));
});

// Start
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Mode: ${isAPI === 1 ? 'API' : 'SSE'}`);
  console.log(`Global Access: ${GLOBAL_ACCESS === 1 ? 'Enabled' : 'Disabled'}`);
});

// Store log helper
async function storeLog(log) {
  try {
    await supabase.from('logs').insert(log);
  } catch (e) {
    console.error('Failed to store log:', e);
  }
} 