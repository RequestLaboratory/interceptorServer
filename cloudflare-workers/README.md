# Cloudflare Worker - Interceptor Test API

This Cloudflare Worker periodically calls the test API endpoint on the interceptor server every 5 minutes to perform a simple database read operation.

## Features

- **Cron Trigger**: Runs automatically every 5 minutes
- **Health Check**: Calls `/api/test` endpoint on the interceptor server
- **Error Handling**: Logs errors and continues running
- **Manual Testing**: Can be triggered manually via HTTP GET request
- **Free Tier Compatible**: Works with Cloudflare's free tier

## Setup

### 1. Deploy to Cloudflare

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Navigate to **Workers & Pages**
3. Click **Create application** > **Create Worker**
4. Copy the contents of `worker.js` into the editor
5. Click **Deploy**

### 2. Configure Environment Variables

1. In your Worker dashboard, go to **Settings** > **Variables**
2. Add a new variable:
   - **Variable name**: `INTERCEPTOR_API_URL`
   - **Value**: Your interceptor server URL (e.g., `https://your-server.com` or `http://localhost:3004` for testing)

**Note**: If you don't set this variable, it will default to `http://localhost:3004`

### 3. Set Up Cron Trigger

1. In your Worker dashboard, go to **Triggers** tab
2. Click **Add Cron Trigger**
3. Enter the cron schedule: `*/5 * * * *`
   - This means: every 5 minutes
   - Format: `minute hour day month day-of-week`
4. Click **Save**

### 4. Verify Setup

After deployment, the worker will:
- Run automatically every 5 minutes via cron trigger
- Call your `/api/test` endpoint
- Log results to Cloudflare's logs

## Manual Testing

You can manually trigger the worker by making a GET request to your worker's URL:

```bash
curl https://your-worker.your-subdomain.workers.dev
```

Or visit the URL in your browser.

## Cron Schedule

The cron expression `*/5 * * * *` means:
- **Minute**: `*/5` (every 5 minutes: 0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55)
- **Hour**: `*` (every hour)
- **Day**: `*` (every day)
- **Month**: `*` (every month)
- **Day of Week**: `*` (every day of week)

## Monitoring

### View Logs

1. Go to your Worker dashboard
2. Click **Logs** tab
3. View real-time execution logs

### View Analytics

1. Go to your Worker dashboard
2. Click **Analytics** tab
3. View execution metrics, success rates, and error counts

## API Endpoint

The worker calls: `{INTERCEPTOR_API_URL}/api/test`

This endpoint performs a simple database read operation (counting interceptors) and returns:
```json
{
  "success": true,
  "message": "Database read successful",
  "data": {
    "interceptorsCount": 5
  },
  "timestamp": "2024-01-15T10:30:00.000Z"
}
```

## Error Handling

The worker includes:
- **30-second timeout** for API calls
- **Error logging** to Cloudflare logs
- **Graceful error handling** that doesn't stop the cron trigger
- **Detailed error messages** for debugging

## Free Tier Limits

Cloudflare Workers free tier includes:
- **100,000 requests per day**
- **10ms CPU time per request** (cron triggers get 50ms)
- **Unlimited cron triggers**
- **128MB memory**

This worker is well within free tier limits.

## Troubleshooting

### Worker not running on schedule
- Check that the cron trigger is set up correctly
- Verify the cron expression: `*/5 * * * *`
- Check the Logs tab for any errors

### API calls failing
- Verify `INTERCEPTOR_API_URL` is set correctly
- Check that your interceptor server is accessible
- Review error logs in the Worker dashboard

### Timeout errors
- The worker has a 30-second timeout
- If your API takes longer, consider optimizing the database query
- Check your interceptor server logs for slow queries
