import { test } from 'node:test'
import assert from 'node:assert/strict'
import { auth } from 'microfed'
import { mergeProfileActor } from '../lib/identity.js'
import { verifyRequest } from '../lib/verify.js'

const HOME = 'https://me.example.com/alice'
const ID = `${HOME}#me`
const BASE = 'https://fedbox.example.com'
const INBOX = 'https://remote.example/inbox'
const { publicKey, privateKey } = auth.generateKeypair()
const other = auth.generateKeypair()

const options = { baseUrl: BASE, username: 'alice', publicKey }

function profile(key) {
  return { id: ID, type: 'Person', name: 'Alice', ...(key && { publicKey: key }) }
}

// Sign as Fedbox does, then verify as a remote server would
async function remoteVerifies(actor, keyId) {
  const body = '{"type":"Follow"}'
  const signed = auth.sign({ privateKey, keyId, method: 'POST', url: INBOX, body })
  const headers = { host: 'remote.example' }
  for (const [name, value] of Object.entries(signed)) headers[name.toLowerCase()] = value
  const docs = { [HOME]: actor }
  const fetchActor = async (url) => docs[url.replace(/#.*$/, '')] ?? null
  return verifyRequest({ method: 'POST', path: '/inbox', headers, body: Buffer.from(body), fetchActor })
}

test('signs with the key id the profile publishes', async () => {
  const { actor } = mergeProfileActor(profile({ id: `${HOME}#main-key`, publicKeyPem: publicKey }), options)
  assert.equal(actor.id, ID)
  assert.equal(actor.inbox, `${BASE}/alice/inbox`)
  assert.equal(actor.publicKey.owner, ID)

  const result = await remoteVerifies(actor, actor.publicKey.id)
  assert.equal(result.valid, true)
  assert.equal(result.actor.id, ID)
})

test('the old local keyId cannot be verified against a profile actor', async () => {
  const { actor } = mergeProfileActor(profile({ id: `${HOME}#main-key`, publicKeyPem: publicKey }), options)
  const result = await remoteVerifies(actor, `${BASE}/alice#main-key`)
  assert.equal(result.valid, false)
})

test('finds our key among several and ignores PEM whitespace', () => {
  const keys = [
    { id: `${HOME}#old-key`, publicKeyPem: other.publicKey },
    { id: `${HOME}#main-key`, publicKeyPem: publicKey.replace(/\n/g, '\r\n') }
  ]
  const { actor } = mergeProfileActor(profile(keys), options)
  assert.equal(actor.publicKey.id, `${HOME}#main-key`)
})

test('rejects a profile with no public key', () => {
  const { actor, error } = mergeProfileActor(profile(), options)
  assert.equal(actor, undefined)
  assert.match(error, /does not publish this server's public key/)
})

test('rejects a profile whose key is not ours', () => {
  const { error } = mergeProfileActor(profile({ id: `${HOME}#main-key`, publicKeyPem: other.publicKey }), options)
  assert.match(error, /does not publish this server's public key/)
})

test('rejects a key on another origin', () => {
  const { error } = mergeProfileActor(profile({ id: `${BASE}/alice#main-key`, publicKeyPem: publicKey }), options)
  assert.match(error, /same origin/)
})

test('rejects a profile with no id', () => {
  const { error } = mergeProfileActor({ type: 'Person' }, options)
  assert.match(error, /no actor id/)
})
