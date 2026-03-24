import test from 'node:test'
import assert from 'node:assert/strict'

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

