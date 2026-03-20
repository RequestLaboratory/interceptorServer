import { vi, describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';

// ─── Supabase mock ────────────────────────────────────────────────────────────
// vi.hoisted ensures these refs are created before vi.mock factories run
const mockSingle = vi.hoisted(() => vi.fn());
// mockChainThen controls what non-.single() awaited chain calls return.
// Tests can use mockChainThen.mockReturnValueOnce(...) to control specific calls.
const mockChainThen = vi.hoisted(() =>
  vi.fn(() => Promise.resolve({ data: null, error: null }))
);

vi.mock('@supabase/supabase-js', () => {
  const makeChain = () => {
    const chain = {};
    // Chainable methods — return the same chain object so calls compose freely
    for (const method of ['select', 'insert', 'delete', 'update', 'eq', 'order']) {
      chain[method] = vi.fn(() => chain);
    }
    // Terminal: .range() returns a resolved promise directly
    chain.range = vi.fn().mockResolvedValue({ data: [], error: null });
    // Terminal: .single() is the shared mockSingle so tests can queue responses
    chain.single = mockSingle;
    // Make the chain itself awaitable (covers patterns like `await supabase.from(...).eq(...)`)
    chain.then = (resolve, reject) => mockChainThen().then(resolve, reject);
    return chain;
  };
  return { createClient: () => ({ from: vi.fn(makeChain) }) };
});

// ─── Axios mock ───────────────────────────────────────────────────────────────
const mockAxios = vi.hoisted(() => {
  const fn = vi.fn();
  fn.post = vi.fn();
  return fn;
});

vi.mock('axios', () => ({ default: mockAxios }));

// ─── App (imported after mocks so the module uses mocked dependencies) ────────
import app from '../server.js';

// ─── Shared helpers ───────────────────────────────────────────────────────────
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const VALID_SESSION = { id: 'sess-1', user_id: 'u1', expires_at: FUTURE };

/** Queue a successful session check as the next mockSingle call. */
function setupAuth(session = VALID_SESSION) {
  mockSingle.mockResolvedValueOnce({ data: session, error: null });
}

// ─── Health & Status ──────────────────────────────────────────────────────────
describe('GET /health', () => {
  it('returns 200 with healthy status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('healthy');
    expect(res.body.timestamp).toBeDefined();
  });
});

describe('GET /status', () => {
  it('returns 200 with api mode and version', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('api');
    expect(res.body.version).toBe('2.0.0');
    expect(res.body.globalAccess).toBe(true);
  });
});

// ─── Snyk analyser ────────────────────────────────────────────────────────────
describe('POST /api/snyk/analyze', () => {
  beforeEach(() => {
    mockAxios.post.mockReset();
  });

  it('returns 400 when body has no dependencies field', async () => {
    const res = await request(app).post('/api/snyk/analyze').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Bad Request');
  });

  it('returns 400 when dependencies object is empty', async () => {
    const res = await request(app)
      .post('/api/snyk/analyze')
      .send({ dependencies: {} });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Bad Request');
  });

  it('proxies to Snyk and returns the result', async () => {
    mockAxios.post.mockResolvedValueOnce({ data: { packages: [{ name: 'react' }] } });

    const res = await request(app)
      .post('/api/snyk/analyze')
      .send({ dependencies: { react: '^18.0.0' } });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ packages: [{ name: 'react' }] });
    expect(mockAxios.post).toHaveBeenCalledOnce();
  });

  it('forwards Snyk API error status and message', async () => {
    const err = Object.assign(new Error('Rate limited'), {
      response: { status: 429, data: { message: 'Too many requests' } },
    });
    mockAxios.post.mockRejectedValueOnce(err);

    const res = await request(app)
      .post('/api/snyk/analyze')
      .send({ dependencies: { lodash: '^4.0.0' } });

    expect(res.status).toBe(429);
    expect(res.body.error).toBe('Snyk API Error');
  });

  it('returns 500 for network-level errors', async () => {
    mockAxios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app)
      .post('/api/snyk/analyze')
      .send({ dependencies: { lodash: '^4.0.0' } });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Proxy Error');
  });
});

// ─── Auth – 401 guards (no Authorization header) ─────────────────────────────
describe('Auth guard — missing Authorization header', () => {
  it.each([
    ['GET',    '/api/interceptors'],
    ['POST',   '/api/interceptors'],
    ['DELETE', '/api/interceptors/abc'],
    ['GET',    '/api/interceptors/abc/logs'],
    ['DELETE', '/api/interceptors/abc/logs'],
  ])('%s %s → 401', async (method, path) => {
    const res = await request(app)[method.toLowerCase()](path);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Unauthorized');
  });
});

describe('Auth guard — "no-login" token short-circuit', () => {
  it.each([
    ['GET',  '/api/interceptors'],
    ['POST', '/api/interceptors'],
  ])('%s %s with Bearer no-login → 401', async (method, path) => {
    const res = await request(app)
      [method.toLowerCase()](path)
      .set('Authorization', 'Bearer no-login');
    expect(res.status).toBe(401);
  });
});

describe('Auth guard — invalid / expired session token', () => {
  beforeEach(() => mockSingle.mockReset());

  it.each([
    ['GET',    '/api/interceptors'],
    ['POST',   '/api/interceptors'],
    ['DELETE', '/api/interceptors/abc'],
    ['GET',    '/api/interceptors/abc/logs'],
    ['DELETE', '/api/interceptors/abc/logs'],
  ])('%s %s with bad token → 401', async (method, path) => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null }); // session not found
    const res = await request(app)
      [method.toLowerCase()](path)
      .set('Authorization', 'Bearer bad-token');
    expect(res.status).toBe(401);
  });
});

// ─── GET /api/interceptors ────────────────────────────────────────────────────
describe('GET /api/interceptors', () => {
  beforeEach(() => mockSingle.mockReset());

  it('returns 200 with interceptor list for authenticated user', async () => {
    setupAuth();

    const res = await request(app)
      .get('/api/interceptors')
      .set('Authorization', 'Bearer sess-1');

    expect(res.status).toBe(200);
  });
});

// ─── POST /api/interceptors ───────────────────────────────────────────────────
describe('POST /api/interceptors', () => {
  beforeEach(() => {
    mockSingle.mockReset();
    mockChainThen.mockReset();
    mockChainThen.mockImplementation(() => Promise.resolve({ data: null, error: null }));
  });

  it('returns 201 and the new interceptor on success', async () => {
    const created = {
      id: 'x1y2z3',
      name: 'My API',
      base_url: 'https://api.example.com',
      user_id: 'u1',
      is_active: true,
      created_at: new Date().toISOString(),
    };

    setupAuth();
    // Count check uses chain.then → resolves { data: null, count: undefined } → passes limit check
    mockSingle.mockResolvedValueOnce({ data: created, error: null }); // insert + select + single

    const res = await request(app)
      .post('/api/interceptors')
      .set('Authorization', 'Bearer sess-1')
      .send({ name: 'My API', base_url: 'https://api.example.com' });

    expect(res.status).toBe(201);
    expect(res.body.id).toBe('x1y2z3');
  });

  it('returns 400 when user has reached the 3-interceptor limit', async () => {
    setupAuth();
    // The count query awaits the chain directly (no .single()), so it goes through
    // chain.then. Return count: 3 to trigger the MAX_INTERCEPTORS_PER_USER limit.
    mockChainThen.mockReturnValueOnce(Promise.resolve({ count: 3, data: null, error: null }));

    const res = await request(app)
      .post('/api/interceptors')
      .set('Authorization', 'Bearer sess-1')
      .send({ name: 'My API', base_url: 'https://api.example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Limit exceeded');
    expect(res.body.message).toContain('3');
  });
});

// ─── DELETE /api/interceptors/:id ────────────────────────────────────────────
describe('DELETE /api/interceptors/:id', () => {
  beforeEach(() => mockSingle.mockReset());

  it('returns 404 when interceptor not found or belongs to another user', async () => {
    setupAuth();
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    const res = await request(app)
      .delete('/api/interceptors/unknown')
      .set('Authorization', 'Bearer sess-1');

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Interceptor not found');
  });

  it('returns 204 on successful deletion', async () => {
    setupAuth();
    mockSingle.mockResolvedValueOnce({ data: { id: 'abc', user_id: 'u1' }, error: null });

    const res = await request(app)
      .delete('/api/interceptors/abc')
      .set('Authorization', 'Bearer sess-1');

    expect(res.status).toBe(204);
  });
});

// ─── GET /api/interceptors/:id/logs ──────────────────────────────────────────
describe('GET /api/interceptors/:id/logs', () => {
  beforeEach(() => mockSingle.mockReset());

  it('returns 404 when interceptor not found', async () => {
    setupAuth();
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    const res = await request(app)
      .get('/api/interceptors/unknown/logs')
      .set('Authorization', 'Bearer sess-1');

    expect(res.status).toBe(404);
  });

  it('returns 200 with logs array for valid interceptor', async () => {
    setupAuth();
    mockSingle.mockResolvedValueOnce({ data: { id: 'abc' }, error: null });

    const res = await request(app)
      .get('/api/interceptors/abc/logs')
      .set('Authorization', 'Bearer sess-1');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('respects limit and offset query params', async () => {
    setupAuth();
    mockSingle.mockResolvedValueOnce({ data: { id: 'abc' }, error: null });

    const res = await request(app)
      .get('/api/interceptors/abc/logs?limit=10&offset=20')
      .set('Authorization', 'Bearer sess-1');

    expect(res.status).toBe(200);
  });
});

// ─── DELETE /api/interceptors/:id/logs ───────────────────────────────────────
describe('DELETE /api/interceptors/:id/logs', () => {
  beforeEach(() => mockSingle.mockReset());

  it('returns 404 when interceptor not found', async () => {
    setupAuth();
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    const res = await request(app)
      .delete('/api/interceptors/unknown/logs')
      .set('Authorization', 'Bearer sess-1');

    expect(res.status).toBe(404);
  });

  it('returns 204 after clearing logs', async () => {
    setupAuth();
    mockSingle.mockResolvedValueOnce({ data: { id: 'abc' }, error: null });

    const res = await request(app)
      .delete('/api/interceptors/abc/logs')
      .set('Authorization', 'Bearer sess-1');

    expect(res.status).toBe(204);
  });
});

// ─── Proxy middleware ─────────────────────────────────────────────────────────
describe('Proxy middleware', () => {
  beforeEach(() => {
    mockSingle.mockReset();
    mockAxios.mockReset();
  });

  it('returns 404 for an unknown interceptor ID', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });

    const res = await request(app).get('/unknown-id/some/path');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Interceptor not found');
  });

  it('proxies GET request to the target base URL', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'abc123', base_url: 'https://api.example.com', is_active: true },
      error: null,
    });
    mockAxios.mockResolvedValueOnce({
      status: 200,
      data: { ok: true },
      headers: { 'content-type': 'application/json' },
    });

    const res = await request(app).get('/abc123/users');
    expect(res.status).toBe(200);
    expect(mockAxios).toHaveBeenCalledOnce();

    const [config] = mockAxios.mock.calls[0];
    expect(config.url).toBe('https://api.example.com/users');
    expect(config.method).toBe('GET');
  });

  it('forwards query parameters to the target URL', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'abc123', base_url: 'https://api.example.com', is_active: true },
      error: null,
    });
    mockAxios.mockResolvedValueOnce({
      status: 200,
      data: { items: [] },
      headers: { 'content-type': 'application/json' },
    });

    const res = await request(app).get('/abc123/users?page=2&limit=10');
    expect(res.status).toBe(200);

    const [config] = mockAxios.mock.calls[0];
    expect(config.url).toBe('https://api.example.com/users?page=2&limit=10');
  });

  it('proxies POST request with body', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'abc123', base_url: 'https://api.example.com', is_active: true },
      error: null,
    });
    mockAxios.mockResolvedValueOnce({
      status: 201,
      data: { id: 99 },
      headers: {},
    });

    const res = await request(app)
      .post('/abc123/items')
      .send({ name: 'thing' });

    expect(res.status).toBe(201);
  });

  it('returns 500 and logs error when upstream request fails', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'abc123', base_url: 'https://api.example.com', is_active: true },
      error: null,
    });
    mockAxios.mockRejectedValueOnce(new Error('upstream timeout'));

    const res = await request(app).get('/abc123/data');
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Proxy error');
  });
});

// ─── T032: Mock-configs routes return 404 in non-development environments ─────
describe('GET /api/mock-configs in non-development mode', () => {
  it('returns 404 when NODE_ENV is not development (proxy falls through)', async () => {
    // In test mode (NODE_ENV=test), the dev-only block is not registered,
    // so the proxy middleware handles the path and returns 404 (no such interceptor).
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    const res = await request(app)
      .get('/api/mock-configs')
      .set('Authorization', 'Bearer sess-1');
    expect(res.status).toBe(404);
  });
});

// ─── T033: Mock-configs CRUD (verify fall-through in test mode) ──────────────
describe('Mock-configs CRUD routes', () => {
  beforeEach(() => {
    mockSingle.mockReset();
    mockChainThen.mockReset();
    mockChainThen.mockImplementation(() => Promise.resolve({ data: null, error: null }));
  });

  it('POST /api/mock-configs → 404 in test mode (proxy handles it)', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    const res = await request(app)
      .post('/api/mock-configs')
      .send({ method: 'GET', url: 'https://example.com', status_code: 200, response_body: {} });
    expect(res.status).toBe(404);
  });

  it('DELETE /api/mock-configs/some-id → 404 in test mode (proxy handles it)', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'not found' } });
    const res = await request(app)
      .delete('/api/mock-configs/some-id')
      .set('Authorization', 'Bearer sess-1');
    expect(res.status).toBe(404);
  });
});

// ─── T034: Mock interception — cache miss path still proxies normally ─────────
describe('Proxy middleware — mock cache interaction', () => {
  beforeEach(() => {
    mockSingle.mockReset();
    mockAxios.mockReset();
  });

  it('calls axios when no mock config is in cache (cache miss)', async () => {
    mockSingle.mockResolvedValueOnce({
      data: { id: 'abc123', base_url: 'https://api.example.com', is_active: true },
      error: null,
    });
    mockAxios.mockResolvedValueOnce({
      status: 200,
      data: { real: true },
      headers: { 'content-type': 'application/json' },
    });

    const res = await request(app).get('/abc123/resource');
    expect(res.status).toBe(200);
    // axios is called because no mock entry exists in the in-memory cache
    expect(mockAxios).toHaveBeenCalledOnce();
    const [config] = mockAxios.mock.calls[0];
    expect(config.url).toBe('https://api.example.com/resource');
  });
});
