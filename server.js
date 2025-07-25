const express = require('express');
const httpProxy = require('http-proxy');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
require('dotenv').config();

const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3002;

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'https://opgwkalkqxudvkqxvfsc.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wZ3drYWxrcXh1ZHZrcXh2ZnNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk1ODI3MjYsImV4cCI6MjA2NTE1ODcyNn0.JQEhK0Iub0e9ZAhO6H0BgzQXWa4S4MUml0fXkwyYN3E';
const supabase = createClient(supabaseUrl, supabaseKey);

// Create HTTP proxy
const proxy = httpProxy.createProxyServer();

// CORS headers configuration
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS, CONNECT',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, apikey, Upgrade, Connection, X-Requested-With, Accept, Accept-Language, Cache-Control, X-API-Key, X-Auth-Token, X-CSRF-Token, X-Forwarded-For, X-Forwarded-Proto, X-Real-IP, User-Agent, Origin, Referer',
  'Access-Control-Max-Age': '86400',
  'Access-Control-Allow-Credentials': 'true',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin'
};

// Helper to handle CORS preflight
function handleCors(req, res) {
  if (req.method === 'OPTIONS') {
    res.status(200).set(corsHeaders).end();
    return true;
  }
  return false;
}

// Helper to add CORS headers to any response
function addCorsHeaders(res) {
  Object.entries(corsHeaders).forEach(([key, value]) => {
    res.set(key, value);
  });
}

// Middleware
app.use(helmet());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// CORS middleware
app.use((req, res, next) => {
  // Handle CORS preflight
  if (handleCors(req, res)) {
    return;
  }
  
  // Add CORS headers to all responses
  addCorsHeaders(res);
  next();
});

// Constants
const MAX_REQUEST_SIZE = 10 * 1024 * 1024; // 10MB
const LOGGABLE_CONTENT_TYPES = [
  'application/json',
  'application/xml',
  'text/',
  'application/x-www-form-urlencoded'
];

// Sensitive headers that should not be logged
const SENSITIVE_HEADERS = [
  'authorization',
  'cookie',
  'x-api-key',
  'x-auth-token',
  'cf-connecting-ip'
];

// Allowed headers for forwarding
const ALLOWED_FORWARD_HEADERS = [
  'content-type',
  'authorization',
  'user-agent',
  'accept',
  'accept-language',
  'cache-control',
  'x-requested-with',
  'x-api-key',
  'x-auth-token'
];

// Utility functions
function shouldLogBody(contentType) {
  if (!contentType) return false;
  return LOGGABLE_CONTENT_TYPES.some(type => contentType.includes(type));
}

function sanitizeHeaders(headers) {
  const sanitized = {};
  
  for (const [key, value] of Object.entries(headers)) {
    if (!SENSITIVE_HEADERS.includes(key.toLowerCase())) {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

function createStructuredLog(data) {
  return {
    timestamp: new Date().toISOString(),
    requestId: require('crypto').randomUUID(),
    ...data
  };
}

function createForwardHeaders(requestHeaders) {
  const forwardHeaders = {};
  for (const [key, value] of Object.entries(requestHeaders)) {
    if (ALLOWED_FORWARD_HEADERS.includes(key.toLowerCase())) {
      forwardHeaders[key] = value;
    }
  }
  return forwardHeaders;
}

// Database helper functions
async function getInterceptor(uniqueCode) {
  try {
    const { data, error } = await supabase
      .from('interceptors')
      .select('*')
      .eq('id', uniqueCode)
      .eq('is_active', true)
      .single();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error fetching interceptor:', error);
    return null;
  }
}

async function storeLog(log) {
  try {
    const { data, error } = await supabase
      .from('logs')
      .insert([log])
      .select();
    
    if (error) throw error;
    return data;
  } catch (error) {
    console.error('Error storing log:', error);
    throw error;
  }
}

// API Routes
app.get('/status', (req, res) => {
  res.json({
    status: 'running',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Get all interceptors
app.get('/api/interceptors', async (req, res) => {
  try {
    console.log('Fetching interceptors');
    const { data, error } = await supabase
      .from('interceptors')
      .select('*')
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching interceptors:', error);
    res.status(500).json({ error: 'Failed to fetch interceptors' });
  }
});

// Create new interceptor
app.post('/api/interceptors', async (req, res) => {
  try {
    const { name, baseUrl } = req.body;
    
    if (!name || !baseUrl) {
      return res.status(400).json({ error: 'Name and baseUrl are required' });
    }
    
    const uniqueCode = Math.random().toString(36).substring(2, 8);
    const interceptor = {
      id: uniqueCode,
      name,
      base_url: baseUrl,
      created_at: new Date().toISOString(),
      is_active: true,
      user_id: 'system' // For now, using system user
    };
    
    const { data, error } = await supabase
      .from('interceptors')
      .insert([interceptor])
      .select()
      .single();
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error creating interceptor:', error);
    res.status(500).json({ error: 'Failed to create interceptor' });
  }
});

// Delete interceptor
app.delete('/api/interceptors/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    const { error } = await supabase
      .from('interceptors')
      .delete()
      .eq('id', id);
    
    if (error) throw error;
    res.status(204).send();
  } catch (error) {
    console.error('Error deleting interceptor:', error);
    res.status(500).json({ error: 'Failed to delete interceptor' });
  }
});

// Get logs for an interceptor
app.get('/api/interceptors/:id/logs', async (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .eq('interceptor_id', id)
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

// Proxy error handling
proxy.on('error', (err, req, res) => {
  console.error('Proxy error:', err);
  res.status(500).json({ error: 'Proxy error', message: err.message });
});

// Main proxy middleware - handles all other requests
app.use(async (req, res, next) => {
  const path = req.path;
  
  // Skip if it's an API route
  if (path.startsWith('/api/') || path === '/status') {
    return next();
  }
  
  // Extract uniqueCode from path
  const pathParts = path.split('/').filter(Boolean);
  if (pathParts.length === 0) {
    return next();
  }
  
  const uniqueCode = pathParts[0];
  const startTime = Date.now();
  
  try {
    // Get interceptor configuration
    const interceptor = await getInterceptor(uniqueCode);
    if (!interceptor) {
      return res.status(404).json({ error: 'Interceptor not found' });
    }
    
    // Validate request size
    const contentLength = parseInt(req.headers['content-length'] || '0');
    if (contentLength > MAX_REQUEST_SIZE) {
      return res.status(413).json({ error: 'Request too large' });
    }
    
    // Extract request body for logging
    let requestBody = null;
    if (req.body && shouldLogBody(req.headers['content-type'])) {
      requestBody = JSON.stringify(req.body);
    }
    
    // Calculate target path (remove the uniqueCode from the path)
    const targetPath = path.replace(`/${uniqueCode}`, '');
    const targetUrl = `${interceptor.base_url}${targetPath}`;
    
    console.log(`Proxying ${req.method} ${path} to ${targetUrl}`);
    
    // Set up response body capture
    let responseBody = null;
    const originalWrite = res.write;
    const originalEnd = res.end;
    const chunks = [];
    
    res.write = function(chunk) {
      chunks.push(chunk);
      return originalWrite.apply(res, arguments);
    };
    
    res.end = function(chunk) {
      if (chunk) {
        chunks.push(chunk);
      }
      
      const duration = Date.now() - startTime;
      const contentType = res.getHeader('content-type');
      
      // Capture response body if loggable
      if (shouldLogBody(contentType)) {
        try {
          responseBody = Buffer.concat(chunks).toString();
        } catch (error) {
          responseBody = '[Error reading response body]';
        }
      } else {
        responseBody = '[Binary or non-loggable content]';
      }
      
      // Create log object
      const log = {
        id: require('crypto').randomUUID(),
        interceptor_id: interceptor.id,
        original_url: targetUrl,
        proxy_url: req.originalUrl,
        method: req.method,
        headers: JSON.stringify(sanitizeHeaders(req.headers)),
        body: requestBody,
        response_status: res.statusCode,
        response_headers: JSON.stringify(sanitizeHeaders(res.getHeaders())),
        response_body: responseBody,
        timestamp: new Date().toISOString(),
        duration: duration
      };
      
      // Store log in database (async, don't wait)
      storeLog(log).catch(error => {
        console.error('Error storing log:', error);
      });
      
      // Log structured data
      const logData = createStructuredLog({
        method: req.method,
        url: req.originalUrl,
        targetUrl: targetUrl,
        status: res.statusCode,
        duration: duration,
        interceptor: interceptor.name
      });
      console.log(JSON.stringify(logData));
      
      // Call original end
      return originalEnd.apply(res, arguments);
    };
    
    // Proxy the request
    proxy.web(req, res, {
      target: interceptor.base_url,
      changeOrigin: true,
      pathRewrite: {
        [`^/${uniqueCode}`]: ''
      },
      onProxyReq: (proxyReq, req, res) => {
        // Create forward headers
        const forwardHeaders = createForwardHeaders(req.headers);
        
        // Set allowed headers
        Object.entries(forwardHeaders).forEach(([key, value]) => {
          proxyReq.setHeader(key, value);
        });
        
        // Add proxy headers
        proxyReq.setHeader('x-forwarded-for', req.ip);
        proxyReq.setHeader('x-forwarded-proto', req.protocol);
        proxyReq.setHeader('x-forwarded-host', req.get('host'));
        
        // Remove problematic headers
        proxyReq.removeHeader('host');
        proxyReq.removeHeader('origin');
        proxyReq.removeHeader('referer');
      }
    });
    
  } catch (error) {
    console.error('Error in proxy middleware:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 API Proxy Server running on port ${PORT}`);
  console.log(`📊 Status: http://localhost:${PORT}/status`);
  console.log(`🔧 API: http://localhost:${PORT}/api/interceptors`);
}); 