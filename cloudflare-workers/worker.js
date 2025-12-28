/**
 * Cloudflare Worker to periodically call the test API endpoint
 * This worker runs every 5 minutes using Cron Triggers
 * 
 * Configuration:
 * - Set INTERCEPTOR_API_URL in Cloudflare Dashboard > Workers > Your Worker > Settings > Variables
 * - Or use the default localhost URL for testing
 * 
 * Cron Trigger Setup:
 * - Go to Cloudflare Dashboard > Workers > Your Worker > Triggers
 * - Add Cron Trigger with schedule: every 5 minutes
 */

// Configuration - can be overridden via environment variables
const DEFAULT_API_URL = 'http://localhost:3004';
const API_TIMEOUT = 30000; // 30 seconds

export default {
  /**
   * Handle scheduled events (cron triggers)
   * Runs every 5 minutes
   * 
   * To set up cron trigger:
   * 1. Go to Cloudflare Dashboard
   * 2. Navigate to Workers & Pages > Your Worker
   * 3. Go to Triggers tab
   * 4. Add Cron Trigger with schedule for every 5 minutes
   */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduledEvent(event, env));
  },

  /**
   * Handle HTTP requests (for manual testing)
   * GET request will trigger the test API call
   */
  async fetch(request, env, ctx) {
    // Allow manual triggering via HTTP request
    if (request.method === 'GET') {
      const result = await callTestAPI(env);
      return new Response(JSON.stringify(result, null, 2), {
        headers: { 
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*',
        },
      });
    }
    
    return new Response(JSON.stringify({ 
      error: 'Method not allowed',
      message: 'Only GET requests are supported for manual testing'
    }), { 
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  },
};

/**
 * Handle the scheduled cron event
 */
async function handleScheduledEvent(event, env) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] Cron trigger fired - calling test API`);
  
  try {
    const result = await callTestAPI(env);
    
    if (result.success) {
      console.log(`[${timestamp}] Test API call successful:`, JSON.stringify(result));
    } else {
      console.error(`[${timestamp}] Test API call failed:`, JSON.stringify(result));
    }
  } catch (error) {
    console.error(`[${timestamp}] Test API call error:`, error.message);
  }
}

/**
 * Call the test API endpoint on the interceptor server
 * 
 * @param {Object} env - Environment variables from Cloudflare
 * @returns {Promise<Object>} Result object with success status and data
 */
async function callTestAPI(env) {
  // Get the API URL from environment variables or use default
  // Set INTERCEPTOR_API_URL in Cloudflare Dashboard > Workers > Settings > Variables
  const API_URL = env.INTERCEPTOR_API_URL || DEFAULT_API_URL;
  const TEST_ENDPOINT = `${API_URL}/api/test`;
  
  const timestamp = new Date().toISOString();
  
  try {
    console.log(`[${timestamp}] Calling test API: ${TEST_ENDPOINT}`);
    
    // Create AbortController for timeout
    const controller = new AbortController();
    
    // Set timeout - Cloudflare Workers compatible approach
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, API_TIMEOUT);
    
    // Make the fetch request
    const response = await fetch(TEST_ENDPOINT, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Cloudflare-Worker/1.0',
        'X-Requested-By': 'Cloudflare-Cron-Worker',
      },
      signal: controller.signal,
    });

    // Clear timeout if request completed
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unable to read error response');
      throw new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    
    return {
      success: true,
      timestamp: timestamp,
      endpoint: TEST_ENDPOINT,
      response: data,
    };
  } catch (error) {
    const isTimeout = error.name === 'AbortError' || error.message.includes('timeout');
    return {
      success: false,
      timestamp: timestamp,
      endpoint: TEST_ENDPOINT,
      error: isTimeout
        ? 'Request timeout after 30 seconds' 
        : error.message || 'Unknown error occurred',
    };
  }
}
