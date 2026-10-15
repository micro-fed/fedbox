import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auth } from 'microfed'
import { verifyRequest } from '../lib/verify.js'

const ACTOR = 'https://remote.example/users/alice'
const KEY_ID = `${ACTOR}#main-key`
const INBOX = 'https://fedbox.example/inbox'
const { publicKey, privateKey } = auth.generateKeypair()
const other = auth.generateKeypair()

const actorDoc = {
  id: ACTOR,
  type: 'Person',
  publicKey: { id: KEY_ID, owner: ACTOR, publicKeyPem: publicKey }
}

function fetchFrom(docs) {
  return async (url) => docs[url.replace(/#.*$/, '')] ?? null
}

function signedRequest({ body = '{"type":"Follow"}', keyId = KEY_ID, key = privateKey } = {}) {
  const signed = auth.sign({ privateKey: key, keyId, method: 'POST', url: INBOX, body })
  const headers = { host: 'fedbox.example' }
  for (const [name, value] of Object.entries(signed)) headers[name.toLowerCase()] = value
  return { method: 'POST', path: '/inbox', headers, body: Buffer.from(body) }
}

const fetchActor = fetchFrom({ [ACTOR]: actorDoc })

test('accepts a correctly signed request', async () => {
  const result = await verifyRequest({ ...signedRequest(), fetchActor })
  assert.equal(result.valid, true)
  assert.equal(result.actor.id, ACTOR)
})

test('rejects a request with no signature', async () => {
  const req = signedRequest()
  delete req.headers.signature
  assert.equal((await verifyRequest({ ...req, fetchActor })).valid, false)
})

test('rejects a body that does not match the digest', async () => {
  const req = signedRequest()
  req.body = Buffer.from('{"type":"Delete"}')
  const result = await verifyRequest({ ...req, fetchActor })
  assert.equal(result.valid, false)
  assert.match(result.reason, /Digest/)
})

test('rejects a forged digest header', async () => {
  const req = signedRequest()
  req.body = Buffer.from('{"type":"Delete"}')
  req.headers.digest = auth.digest(req.body)
  const result = await verifyRequest({ ...req, fetchActor })
  assert.equal(result.valid, false)
  assert.match(result.reason, /verification failed/)
})

test('rejects a signature that does not cover digest', async () => {
  const req = signedRequest()
  req.headers.signature = req.headers.signature.replace(' digest"', '"')
  const result = await verifyRequest({ ...req, fetchActor })
  assert.equal(result.valid, false)
  assert.match(result.reason, /does not cover digest/)
})

test('rejects a stale date', async () => {
  const req = signedRequest()
  const result = await verifyRequest({ ...req, fetchActor, now: Date.now() + 2 * 60 * 60 * 1000 })
  assert.equal(result.valid, false)
  assert.match(result.reason, /Date/)
})

test('rejects a signature made with a different key', async () => {
  const req = signedRequest({ key: other.privateKey })
  const result = await verifyRequest({ ...req, fetchActor })
  assert.equal(result.valid, false)
})

test('rejects a key the actor does not publish', async () => {
  const req = signedRequest({ keyId: `${ACTOR}#other-key`, key: other.privateKey })
  const result = await verifyRequest({ ...req, fetchActor })
  assert.equal(result.valid, false)
  assert.match(result.reason, /resolve key/)
})

test('rejects a key whose owner is a different actor', async () => {
  const doc = { ...actorDoc, publicKey: { ...actorDoc.publicKey, owner: 'https://evil.example/users/mallory' } }
  const result = await verifyRequest({ ...signedRequest(), fetchActor: fetchFrom({ [ACTOR]: doc }) })
  assert.equal(result.valid, false)
  assert.match(result.reason, /owner/)
})

test('resolves a standalone key document via its owner', async () => {
  const keyUrl = 'https://remote.example/keys/1'
  const actor = { ...actorDoc, publicKey: { id: keyUrl, owner: ACTOR, publicKeyPem: publicKey } }
  const docs = { [ACTOR]: actor, [keyUrl]: { id: keyUrl, owner: ACTOR, publicKeyPem: publicKey } }
  const result = await verifyRequest({ ...signedRequest({ keyId: keyUrl }), fetchActor: fetchFrom(docs) })
  assert.equal(result.valid, true)
  assert.equal(result.actor.id, ACTOR)
})

test('rejects a key document that claims another origin\'s actor', async () => {
  // evil.example hosts a document claiming to be alice, publishing its own key
  const evilKey = 'https://evil.example/users/mallory#main-key'
  const forged = {
    id: ACTOR,
    type: 'Person',
    publicKey: { id: evilKey, owner: ACTOR, publicKeyPem: other.publicKey }
  }
  const docs = { [ACTOR]: actorDoc, 'https://evil.example/users/mallory': forged }
  const req = signedRequest({ keyId: evilKey, key: other.privateKey })
  const result = await verifyRequest({ ...req, fetchActor: fetchFrom(docs) })
  assert.equal(result.valid, false)
  assert.match(result.reason, /resolve key/)
})

test('rejects a standalone key whose owner resolves to another origin', async () => {
  const keyUrl = 'https://evil.example/keys/1'
  const docs = {
    [keyUrl]: { id: keyUrl, owner: 'https://evil.example/users/x', publicKeyPem: other.publicKey },
    'https://evil.example/users/x': { ...actorDoc, publicKey: { id: keyUrl, owner: ACTOR, publicKeyPem: other.publicKey } }
  }
  const req = signedRequest({ keyId: keyUrl, key: other.privateKey })
  const result = await verifyRequest({ ...req, fetchActor: fetchFrom(docs) })
  assert.equal(result.valid, false)
})
