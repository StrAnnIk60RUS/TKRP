import test from 'node:test'
import assert from 'node:assert/strict'
import cors from 'cors'

import {
  createCorsOptions,
  requireLocalOrAdminApiKey,
  requireLocalOrApiKey
} from '../src/shared/http/security.js'

function createMockResponse() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code
      return this
    },
    json(payload) {
      this.payload = payload
      return this
    }
  }
}

test('createCorsOptions allows localhost origin by default', async () => {
  const corsOptions = createCorsOptions()

  await new Promise((resolve, reject) => {
    corsOptions.origin('http://localhost:5173', (error, allowed) => {
      if (error) {
        reject(error)
        return
      }
      assert.equal(allowed, true)
      resolve()
    })
  })
})

test('createCorsOptions allows localhost origin on any port (Vite fallback)', async () => {
  const corsOptions = createCorsOptions()

  await new Promise((resolve, reject) => {
    corsOptions.origin('http://localhost:5174', (error, allowed) => {
      if (error) {
        reject(error)
        return
      }
      assert.equal(allowed, true)
      resolve()
    })
  })
})

test('createCorsOptions includes telemetry and trace headers in allowedHeaders and exposedHeaders', () => {
  const corsOptions = createCorsOptions()

  assert.ok(Array.isArray(corsOptions.allowedHeaders))
  assert.ok(corsOptions.allowedHeaders.includes('x-trace-id'))
  assert.ok(corsOptions.allowedHeaders.includes('X-Trace-Id'))
  assert.ok(corsOptions.allowedHeaders.includes('x-request-id'))
  assert.ok(corsOptions.allowedHeaders.includes('X-Request-Id'))
  assert.ok(corsOptions.allowedHeaders.includes('Content-Type'))
  assert.ok(corsOptions.allowedHeaders.includes('Authorization'))
  assert.ok(corsOptions.allowedHeaders.includes('X-Server-API-Key'))

  assert.ok(Array.isArray(corsOptions.exposedHeaders))
  assert.ok(corsOptions.exposedHeaders.includes('x-trace-id'))
  assert.ok(corsOptions.exposedHeaders.includes('X-Trace-Id'))
  assert.ok(corsOptions.exposedHeaders.includes('x-request-id'))
  assert.ok(corsOptions.exposedHeaders.includes('X-Request-Id'))
})

test('createCorsOptions extends allowedHeaders with CORS_ALLOWED_HEADERS env', () => {
  const prev = process.env.CORS_ALLOWED_HEADERS
  process.env.CORS_ALLOWED_HEADERS = 'X-Custom-Client-Id, X-Another-Header'
  try {
    const corsOptions = createCorsOptions()
    assert.ok(corsOptions.allowedHeaders.includes('X-Custom-Client-Id'))
    assert.ok(corsOptions.allowedHeaders.includes('X-Another-Header'))
    assert.ok(corsOptions.allowedHeaders.includes('x-trace-id'))
  } finally {
    if (prev === undefined) {
      delete process.env.CORS_ALLOWED_HEADERS
    } else {
      process.env.CORS_ALLOWED_HEADERS = prev
    }
  }
})

test('cors middleware permits x-trace-id in preflight OPTIONS request', async () => {
  const corsMiddleware = cors(createCorsOptions())
  const req = {
    method: 'OPTIONS',
    headers: {
      origin: 'http://localhost:5173',
      'access-control-request-method': 'GET',
      'access-control-request-headers': 'x-trace-id'
    }
  }
  const headersSet = {}
  let ended = false
  const res = {
    statusCode: null,
    setHeader(key, value) {
      headersSet[key.toLowerCase()] = value
    },
    getHeader(key) {
      return headersSet[key.toLowerCase()]
    },
    end() {
      ended = true
    }
  }

  await new Promise((resolve, reject) => {
    corsMiddleware(req, res, (err) => {
      if (err) reject(err)
      else resolve()
    })
    if (ended) resolve()
  })

  assert.equal(headersSet['access-control-allow-origin'], 'http://localhost:5173')
  const allowed = headersSet['access-control-allow-headers']
  assert.ok(allowed, 'Access-Control-Allow-Headers must be set')
  const allowedList = allowed.split(',').map((h) => h.trim().toLowerCase())
  assert.ok(allowedList.includes('x-trace-id'), 'x-trace-id must be allowed in CORS preflight')
})

test('requireLocalOrApiKey accepts local requests without key', () => {
  const req = { clientIp: '127.0.0.1', headers: {}, requestId: 'req-1' }
  const res = createMockResponse()
  let nextCalled = false

  requireLocalOrApiKey(req, res, () => {
    nextCalled = true
  })

  assert.equal(nextCalled, true)
  assert.equal(res.statusCode, 200)
})

test('requireLocalOrAdminApiKey rejects remote request without key', () => {
  const req = { clientIp: '8.8.8.8', headers: {}, requestId: 'req-2' }
  const res = createMockResponse()
  const previousKey = process.env.ADMIN_API_KEY
  process.env.ADMIN_API_KEY = 'secret-admin'

  requireLocalOrAdminApiKey(req, res, () => {})

  assert.equal(res.statusCode, 403)
  assert.equal(res.payload.error, 'Admin API key required for this endpoint.')

  if (previousKey === undefined) {
    delete process.env.ADMIN_API_KEY
  } else {
    process.env.ADMIN_API_KEY = previousKey
  }
})

