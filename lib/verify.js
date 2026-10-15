/**
 * Inbound HTTP Signature verification (draft-cavage, rsa-sha256)
 *
 * Returns { valid: true, actor } only when:
 * - the signature covers (request-target), host, date and digest
 * - Date is within Mastodon's window (5 min expiry + 1 h clock skew)
 * - Digest matches the raw request body
 * - the key is published by the actor that owns it
 * - the signature verifies against that key
 *
 * The caller must still check that activity.actor === actor.id.
 */

import { createHash } from 'crypto'
import { auth } from 'microfed'

const REQUIRED_HEADERS = ['(request-target)', 'host', 'date', 'digest']
const MAX_AGE_MS = 65 * 60 * 1000
const MAX_FUTURE_MS = 60 * 60 * 1000

function fail(reason) {
  return { valid: false, reason }
}

function idOf(value) {
  return typeof value === 'string' ? value : value?.id
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

/**
 * Fetch a document and make sure it really lives where we fetched it:
 * a server may only speak for ids on its own origin (FEP-fe34).
 */
async function fetchOwnDocument(url, fetchActor) {
  const doc = await fetchActor(url)
  return doc && sameOrigin(doc.id, url) ? doc : null
}

/**
 * Find the key matching keyId and the actor that owns it.
 * keyId is usually actor#main-key, but may be a standalone key document.
 */
async function resolveKey(keyId, fetchActor) {
  const doc = await fetchOwnDocument(keyId, fetchActor)
  if (!doc) return null

  const keys = [].concat(doc.publicKey || [])
  const key = keys.find(k => k.id === keyId)
  if (key) return { key, actor: doc }

  // Standalone key document: { id, owner, publicKeyPem }
  if (doc.id === keyId && doc.owner && doc.publicKeyPem) {
    const actor = await fetchOwnDocument(idOf(doc.owner), fetchActor)
    const owned = [].concat(actor?.publicKey || []).find(k => k.id === keyId)
    if (owned) return { key: owned, actor }
  }
  return null
}

/**
 * @param {Object} options
 * @param {string} options.method - HTTP method
 * @param {string} options.path - Request path including query string (req.url)
 * @param {Object} options.headers - Lower-cased request headers
 * @param {Buffer|string} options.body - Raw request body
 * @param {Function} options.fetchActor - async (url) => JSON document or null
 * @param {number} [options.now] - Current time in ms (for tests)
 */
export async function verifyRequest({ method, path, headers, body, fetchActor, now = Date.now() }) {
  const sig = headers.signature && auth.parseSignatureHeader(headers.signature)
  if (!sig) return fail('Missing or malformed Signature header')

  const signed = (sig.headers || 'date').toLowerCase().split(/\s+/)
  for (const name of REQUIRED_HEADERS) {
    if (!signed.includes(name)) return fail(`Signature does not cover ${name}`)
  }
  for (const name of signed) {
    if (name !== '(request-target)' && headers[name] === undefined) {
      return fail(`Missing signed header: ${name}`)
    }
  }

  const date = Date.parse(headers.date)
  if (Number.isNaN(date)) return fail('Invalid Date header')
  if (now - date > MAX_AGE_MS || date - now > MAX_FUTURE_MS) {
    return fail('Date outside the allowed window')
  }

  const [algorithm, value] = headers.digest.split(/=(.*)/s)
  const expected = createHash('sha256').update(body).digest('base64')
  if (algorithm.toLowerCase() !== 'sha-256' || value !== expected) {
    return fail('Digest does not match body')
  }

  const resolved = await resolveKey(sig.keyId, fetchActor)
  if (!resolved?.key.publicKeyPem) return fail(`Could not resolve key: ${sig.keyId}`)
  const { key, actor } = resolved
  if (idOf(key.owner) && idOf(key.owner) !== actor.id) {
    return fail('Key owner does not match actor')
  }

  const ok = auth.verify({
    publicKey: key.publicKeyPem,
    signature: headers.signature,
    method,
    path,
    headers
  })
  if (!ok) return fail('Signature verification failed')

  return { valid: true, actor }
}

export default { verifyRequest }
