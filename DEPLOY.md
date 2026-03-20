# Railway Deployment Guide

Deploy the interceptorServer directly from local to Railway.

## Prerequisites

- Railway CLI installed: `npm install -g @railway/cli`
- Logged in: `railway login`

## Steps

```bash
# 1. Navigate to the interceptorServer directory
cd interceptorServer

# 2. Link to the Railway project (one-time setup)
railway link --project requestlab-interceptor
# Select: ashbatman's Projects → requestlab-interceptor → production

# 3. Deploy
railway up --service interceptor-server
```

## Notes

- Project: `requestlab-interceptor`
- Service: `interceptor-server`
- Environment: `production`
- The `railway link` step only needs to be done once per machine. After that, just run `railway up --service interceptor-server` from the `interceptorServer` directory.
- Use `--detach` flag to skip streaming logs: `railway up --service interceptor-server --detach`
