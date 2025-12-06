import express from 'express';
import { createClient } from '@supabase/supabase-js';
import cors from 'cors';
import dotenv from 'dotenv';
import axios from 'axios';
import crypto from 'crypto';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3004;

// Supabase client
const supabaseUrl = process.env.SUPABASE_URL || 'https://opgwkalkqxudvkqxvfsc.supabase.co';
const supabaseKey = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9wZ3drYWxrcXh1ZHZrcXh2ZnNjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDk1ODI3MjYsImV4cCI6MjA2NTE1ODcyNn0.JQEhK0Iub0e9ZAhO6H0BgzQXWa4S4MUml0fXkwyYN3E';
const supabase = createClient(supabaseUrl, supabaseKey);

// Helper function to sanitize headers
function sanitizeHeaders(headers) {
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token', 'cf-connecting-ip'];
  const sanitized = {};
  for (const [key, value] of Object.entries(headers)) {
    if (!sensitiveHeaders.includes(key.toLowerCase())) {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// Helper function to verify session and extract user_id
async function verifySession(sessionId) {
  try {
    const { data: session, error } = await supabase
      .from('sessions')
      .select('*')
      .eq('id', sessionId)
      .single();

    if (error || !session) {
      return { authenticated: false };
    }

    // Check if session is expired
    if (new Date(session.expires_at) < new Date()) {
      await supabase.from('sessions').delete().eq('id', sessionId);
      return { authenticated: false };
    }

    // Extract user_id from session
    // Check if user_id column exists, otherwise get from user_data
    const userId = session.user_id || session.user_data?.id || null;
    
    if (!userId) {
      return { authenticated: false };
    }

    return {
      authenticated: true,
      user_id: userId
    };
  } catch (error) {
    console.error('Session verification error:', error);
    return { authenticated: false };
  }
}

// Helper function to extract user_id from request
async function getUserIdFromRequest(req) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader) {
    return null;
  }

  const sessionId = authHeader.replace('Bearer ', '');
  if (!sessionId || sessionId === 'no-login') {
    return null;
  }

  const session = await verifySession(sessionId);
  if (!session.authenticated) {
    return null;
  }

  return session.user_id;
}

// Helper function to store log
async function storeLog(log) {
  try {
    await supabase.from('logs').insert(log);
    console.log(`✅ Log stored for ${log.method} ${log.proxy_url} (${log.response_status})`);
  } catch (error) {
    console.error('❌ Failed to store log:', error);
  }
}

// CORS Configuration
const corsOptions = {
  origin: [
    'http://localhost:5173',
    'http://localhost:5174', 
    'http://localhost:3000',
    'http://localhost:4173',
    'https://www.requestlab.cc',
    'https://requestlab.cc'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH', 'HEAD'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'ngrok-skip-browser-warning',
    'X-Requested-With',
    'Accept',
    'Accept-Language',
    'Cache-Control',
    'X-API-Key',
    'X-Auth-Token'
  ],
  optionsSuccessStatus: 200
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Parse JSON
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Status endpoint
app.get('/status', (req, res) => {
  res.json({
    mode: 'api',
    globalAccess: true,
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString()
  });
});

// Snyk NPM Package Analyser proxy endpoint
app.post('/api/snyk/analyze', async (req, res) => {
  console.log('📦 POST /api/snyk/analyze called');
  
  try {
    const { dependencies } = req.body;
    
    if (!dependencies || Object.keys(dependencies).length === 0) {
      return res.status(400).json({ 
        error: 'Bad Request', 
        message: 'No dependencies provided' 
      });
    }

    console.log(`Analyzing ${Object.keys(dependencies).length} dependencies...`);

    // Proxy request to Snyk API
    const response = await axios.post(
      'https://snyk.io/advisor/upload/check-packages/npm',
      { dependencies },
      {
        headers: {
          'accept': 'application/json, text/plain, */*',
          'content-type': 'application/json',
          'origin': 'https://snyk.io',
          'referer': 'https://snyk.io/advisor/check/npm',
          'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'
        },
        timeout: 30000
      }
    );

    console.log('Snyk API response:', response.data);
    res.json(response.data);

  } catch (error) {
    console.error('Snyk API error:', error.message);
    
    if (error.response) {
      // Snyk API returned an error
      res.status(error.response.status).json({
        error: 'Snyk API Error',
        message: error.response.data?.message || error.message,
        status: error.response.status
      });
    } else {
      // Network or other error
      res.status(500).json({
        error: 'Proxy Error',
        message: error.message
      });
    }
  }
});

// Get interceptors
app.get('/api/interceptors', async (req, res) => {
  console.log('GET /api/interceptors called');
  try {
    const userId = await getUserIdFromRequest(req);
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Valid session required' });
    }

    // Filter interceptors by user_id
    const { data, error } = await supabase
      .from('interceptors')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
});

// Create interceptor
const MAX_INTERCEPTORS_PER_USER = 3;

app.post('/api/interceptors', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Valid session required' });
    }

    // Check current interceptor count for user
    const { count, error: countError } = await supabase
      .from('interceptors')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    
    if (countError) {
      throw countError;
    }

    // Check if user has reached the limit
    if (count >= MAX_INTERCEPTORS_PER_USER) {
      return res.status(400).json({ 
        error: 'Limit exceeded', 
        message: `Maximum ${MAX_INTERCEPTORS_PER_USER} interceptors per user reached. Please delete an existing interceptor to create a new one.` 
      });
    }

    const uniqueCode = Math.random().toString(36).substring(2, 8);
    const interceptor = {
      id: uniqueCode,
      name: req.body.name,
      base_url: req.body.base_url || req.body.baseUrl,
      created_at: new Date().toISOString(),
      is_active: true,
      user_id: userId
    };
    const { data, error } = await supabase.from('interceptors').insert(interceptor).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
});

// Delete interceptor
app.delete('/api/interceptors/:id', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Valid session required' });
    }

    const { id } = req.params;
    
    // First check if interceptor exists and belongs to user
    const { data: interceptor, error: fetchError } = await supabase
      .from('interceptors')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    
    if (fetchError || !interceptor) {
      return res.status(404).json({ error: 'Interceptor not found', message: 'Interceptor does not exist or you do not have permission to delete it' });
    }

    // Delete the interceptor
    const { error } = await supabase
      .from('interceptors')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);
    
    if (error) throw error;
    res.status(204).end();
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
});

// Get logs
app.get('/api/interceptors/:id/logs', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Valid session required' });
    }

    const { id } = req.params;
    
    // First verify that the interceptor belongs to the user
    const { data: interceptor, error: interceptorError } = await supabase
      .from('interceptors')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    
    if (interceptorError || !interceptor) {
      return res.status(404).json({ error: 'Interceptor not found', message: 'Interceptor does not exist or you do not have permission to view its logs' });
    }

    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;
    
    // Get logs for this interceptor (ownership already verified above)
    const { data, error } = await supabase
      .from('logs')
      .select('*')
      .eq('interceptor_id', id)
      .order('timestamp', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (error) throw error;
    res.json(data);
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
});

// Delete all logs for an interceptor
app.delete('/api/interceptors/:id/logs', async (req, res) => {
  try {
    const userId = await getUserIdFromRequest(req);
    
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', message: 'Valid session required' });
    }

    const { id } = req.params;
    
    // First verify that the interceptor belongs to the user
    const { data: interceptor, error: interceptorError } = await supabase
      .from('interceptors')
      .select('id')
      .eq('id', id)
      .eq('user_id', userId)
      .single();
    
    if (interceptorError || !interceptor) {
      return res.status(404).json({ error: 'Interceptor not found', message: 'Interceptor does not exist or you do not have permission to delete its logs' });
    }

    const { error } = await supabase.from('logs').delete().eq('interceptor_id', id);
    if (error) throw error;
    res.status(204).end();
  } catch (error) {
    console.error('Database error:', error);
    res.status(500).json({ error: 'Database error', message: error.message });
  }
});

// Proxy middleware - handle all other requests
app.use(async (req, res, next) => {
  // Extract interceptor ID from path
  const pathParts = req.path.split('/').filter(Boolean);
  if (pathParts.length === 0) {
    return res.status(404).json({ error: 'Not found' });
  }
  
  const interceptorId = pathParts[0];
  console.log(`🔄 Proxy request: ${req.method} ${req.path} -> interceptor: ${interceptorId}`);
  
  // Capture request details for logging
  const startTime = Date.now();
  const requestHeaders = JSON.stringify(sanitizeHeaders(req.headers));
  const requestBody = req.body ? JSON.stringify(req.body) : '';
  let targetUrl = 'unknown'; // Initialize targetUrl
  
  try {
    // Get interceptor from database
    const { data: interceptor, error } = await supabase
      .from('interceptors')
      .select('*')
      .eq('id', interceptorId)
      .eq('is_active', true)
      .single();
    
    if (error || !interceptor) {
      console.log(`❌ Interceptor not found: ${interceptorId}`);
      return res.status(404).json({ error: 'Interceptor not found' });
    }
    
    // Build target path
    const targetPath = req.path.replace(`/${interceptorId}`, '') || '/';
    targetUrl = interceptor.base_url.replace(/\/$/, '') + targetPath;
    console.log(`📡 Proxying to: ${targetUrl}`);
    
    // Prepare headers for proxy request
    const proxyHeaders = { ...req.headers };
    delete proxyHeaders.host;
    delete proxyHeaders['x-forwarded-for'];
    delete proxyHeaders['x-forwarded-proto'];
    delete proxyHeaders['x-forwarded-host'];
    
    // Make the proxy request using axios
    const axiosConfig = {
      method: req.method,
      url: targetUrl,
      headers: proxyHeaders,
      timeout: 30000,
      validateStatus: () => true // Don't throw on any status code
    };
    
    // Add body for methods that support it
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
      axiosConfig.data = req.body;
    }
    
    console.log(`🚀 Making ${req.method} request to ${targetUrl}`);
    const proxyResponse = await axios(axiosConfig);
    
    // Capture response details
    const duration = Date.now() - startTime;
    const responseStatus = proxyResponse.status;
    const responseHeaders = JSON.stringify(sanitizeHeaders(proxyResponse.headers));
    const responseBody = typeof proxyResponse.data === 'string' ? proxyResponse.data : JSON.stringify(proxyResponse.data);
    
    // Store log
    const log = {
      id: crypto.randomUUID(),
      interceptor_id: interceptor.id,
      original_url: targetUrl,
      proxy_url: req.originalUrl,
      method: req.method,
      headers: requestHeaders,
      body: requestBody,
      response_status: responseStatus,
      response_headers: responseHeaders,
      response_body: responseBody,
      timestamp: new Date().toISOString(),
      duration: duration
    };
    
    await storeLog(log);
    
    // Forward the response
    res.status(responseStatus);
    
    // Set response headers
    Object.entries(proxyResponse.headers).forEach(([key, value]) => {
      if (key.toLowerCase() !== 'content-length') {
        res.set(key, value);
      }
    });
    
    // Send response body
    res.send(proxyResponse.data);
    
  } catch (error) {
    console.error('❌ Proxy error:', error);
    
    // Log the error
    const duration = Date.now() - startTime;
    const log = {
      id: crypto.randomUUID(),
      interceptor_id: interceptorId,
      original_url: targetUrl,
      proxy_url: req.originalUrl,
      method: req.method,
      headers: requestHeaders,
      body: requestBody,
      response_status: 500,
      response_headers: '{}',
      response_body: JSON.stringify({ error: 'Proxy error', message: error.message }),
      timestamp: new Date().toISOString(),
      duration: duration
    };
    
    await storeLog(log);
    
    res.status(500).json({ error: 'Proxy error', message: error.message });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  if (!res.headersSent) {
    res.status(500).json({ error: 'Internal server error', message: err.message });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Simple Interceptor Proxy Server running on port ${PORT}`);
  console.log(`📡 CORS enabled for localhost origins`);
  console.log(`🔄 Proxy functionality enabled`);
  console.log(`📝 Logging functionality enabled`);
  console.log(`🌐 Health check: http://localhost:${PORT}/health`);
  console.log(`📈 Status: http://localhost:${PORT}/status`);
});
