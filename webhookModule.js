import { Server } from 'socket.io';
import axios from 'axios';

// In-memory storage for webhook requests
// requests: { [sessionId]: [ { id, method, headers, body, query, timestamp, path } ] }
const requests = {};
// forwardConfigs: { [sessionId]: targetUrl }
const forwardConfigs = {};

const MAX_REQUESTS_PER_SESSION = 50;

/**
 * Initialize webhook module with Socket.IO server
 * @param {http.Server} httpServer - HTTP server instance
 * @param {Express} app - Express app instance
 * @param {Function} getUserIdFromRequest - Function to get user ID from request
 * @returns {Server} Socket.IO server instance
 */
export function initializeWebhookModule(httpServer, app, getUserIdFromRequest) {
  // Initialize Socket.IO
  const io = new Server(httpServer, {
    cors: {
      origin: [
        'http://localhost:5173',
        'http://localhost:5174',
        'http://localhost:3000',
        'http://localhost:4173',
        'https://www.requestlab.cc',
        'https://requestlab.cc'
      ],
      methods: ['GET', 'POST'],
      credentials: true
    }
  });

  // Socket.IO connection handling
  io.on('connection', (socket) => {
    console.log('Webhook client connected:', socket.id);

    socket.on('join', async (data) => {
      const { sessionId } = data;
      if (!sessionId) {
        socket.emit('error', { message: 'Session ID is required' });
        return;
      }

      socket.join(sessionId);
      console.log(`Socket ${socket.id} joined session ${sessionId}`);

      // Send existing requests for this session
      if (requests[sessionId]) {
        socket.emit('initial_requests', requests[sessionId]);
      }

      // Send existing forward config
      if (forwardConfigs[sessionId]) {
        socket.emit('forward_config', { targetUrl: forwardConfigs[sessionId] });
      }
    });

    socket.on('disconnect', () => {
      console.log('Webhook client disconnected:', socket.id);
    });
  });

  /**
   * Forward a captured request to a target URL
   */
  async function forwardRequest(requestData, targetUrl) {
    try {
      const { method, headers, body, query } = requestData;

      // Filter out headers that might cause issues or are specific to the proxy
      const headersToForward = { ...headers };
      delete headersToForward['host'];
      delete headersToForward['content-length'];
      delete headersToForward['connection'];

      console.log(`Forwarding ${method} request to ${targetUrl}`);

      await axios({
        method: method,
        url: targetUrl,
        headers: headersToForward,
        data: body,
        params: query,
        validateStatus: () => true, // Resolve promise for all status codes
      });

      console.log(`Successfully forwarded to ${targetUrl}`);
      return true;
    } catch (error) {
      console.error(`Failed to forward request to ${targetUrl}:`, error.message);
      return false;
    }
  }

  // Configure forwarding endpoint
  app.post('/api/webhooks/:sessionId/forward-config', async (req, res) => {
    try {
      const userId = await getUserIdFromRequest(req);
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Valid session required' });
      }

      const { sessionId } = req.params;
      const { targetUrl } = req.body;

      // Verify session belongs to user (sessionId should be user-specific or validated)
      // For now, we'll allow it if user is authenticated
      // You might want to add additional validation here

      if (targetUrl) {
        forwardConfigs[sessionId] = targetUrl;
      } else {
        delete forwardConfigs[sessionId];
      }

      // Notify clients in the session about the config change
      io.to(sessionId).emit('forward_config', { targetUrl: forwardConfigs[sessionId] || null });

      res.json({ success: true, targetUrl: forwardConfigs[sessionId] || null });
    } catch (error) {
      console.error('Error setting forward config:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });

  // Clear requests endpoint
  app.post('/api/webhooks/:sessionId/clear', async (req, res) => {
    try {
      const userId = await getUserIdFromRequest(req);
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Valid session required' });
      }

      const { sessionId } = req.params;

      if (requests[sessionId]) {
        requests[sessionId] = [];
        io.to(sessionId).emit('requests_cleared');
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error clearing requests:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });

  // Get requests for a session
  app.get('/api/webhooks/:sessionId/requests', async (req, res) => {
    try {
      const userId = await getUserIdFromRequest(req);
      
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Valid session required' });
      }

      const { sessionId } = req.params;
      const sessionRequests = requests[sessionId] || [];

      res.json(sessionRequests);
    } catch (error) {
      console.error('Error getting requests:', error);
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  });

  // Capture Webhook endpoint - this should be accessible without auth (webhooks come from external sources)
  // Note: This endpoint must be registered before the proxy middleware
  app.all('/api/webhooks/:sessionId', async (req, res) => {
    const { sessionId } = req.params;

    const requestData = {
      id: Date.now().toString() + Math.random().toString(36).substring(2, 9),
      method: req.method,
      headers: req.headers,
      query: req.query,
      body: req.body,
      timestamp: new Date().toISOString(),
      path: req.path
    };

    // Store request
    if (!requests[sessionId]) {
      requests[sessionId] = [];
    }
    requests[sessionId].unshift(requestData);

    // Limit storage
    if (requests[sessionId].length > MAX_REQUESTS_PER_SESSION) {
      requests[sessionId] = requests[sessionId].slice(0, MAX_REQUESTS_PER_SESSION);
    }

    // Emit to socket room
    io.to(sessionId).emit('webhook_received', requestData);

    // Forward if configured
    if (forwardConfigs[sessionId]) {
      // Forward asynchronously, don't wait for it to respond to the webhook sender
      forwardRequest(requestData, forwardConfigs[sessionId]).catch(err => {
        console.error("Error forwarding in background:", err);
      });
    }

    // Respond to the webhook sender
    res.status(200).send('Webhook received');
  });

  return io;
}

