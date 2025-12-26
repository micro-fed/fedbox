/**
 * Fedbox Server
 * ActivityPub server using microfed
 * Solid-compatible URI structure
 */

import { createServer } from 'http'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import { profile, auth, webfinger, outbox } from 'microfed'
import {
  initStore,
  addFollower,
  removeFollower,
  getFollowers,
  getFollowerCount,
  addFollowing,
  acceptFollowing,
  getFollowingCount,
  saveActivity,
  getActivities,
  savePost,
  getPosts,
  getPost,
  cacheActor,
  getCachedActor
} from './store.js'

let config = null
let actor = null

// Rate limiting: track requests per IP
const rateLimits = new Map()
const RATE_LIMIT_WINDOW = 60000 // 1 minute
const RATE_LIMIT_MAX = 100 // max requests per window

/**
 * Load configuration
 */
function loadConfig() {
  if (!existsSync('fedbox.json')) {
    throw new Error('Not initialized. Run: fedbox init')
  }
  config = JSON.parse(readFileSync('fedbox.json', 'utf8'))
  return config
}

/**
 * Get the domain (with ngrok support)
 */
function getDomain() {
  return config.domain || `localhost:${config.port}`
}

/**
 * Get protocol
 */
function getProtocol() {
  return config.domain ? 'https' : 'http'
}

/**
 * Get base URL
 */
function getBaseUrl() {
  return `${getProtocol()}://${getDomain()}`
}

/**
 * Build actor object with Solid-compatible URIs
 * /alice is the profile document
 * /alice#me is the WebID (the Person)
 */
function buildActor() {
  const baseUrl = getBaseUrl()
  const profileUrl = `${baseUrl}/${config.username}`
  const actorId = `${profileUrl}#me`

  // Build actor manually for more control over structure
  const actor = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1'
    ],
    type: 'Person',
    id: actorId,
    url: profileUrl,
    preferredUsername: config.username,
    name: config.displayName,
    summary: config.summary ? `<p>${config.summary}</p>` : '',
    inbox: `${profileUrl}/inbox`,
    outbox: `${profileUrl}/outbox`,
    followers: `${profileUrl}/followers`,
    following: `${profileUrl}/following`,
    endpoints: {
      sharedInbox: `${baseUrl}/inbox`
    },
    publicKey: {
      id: `${profileUrl}#main-key`,
      owner: actorId,
      publicKeyPem: config.publicKey
    }
  }

  // Add icon if avatar is set
  if (config.avatar) {
    actor.icon = {
      type: 'Image',
      mediaType: config.avatar.endsWith('.png') ? 'image/png' :
                 config.avatar.endsWith('.gif') ? 'image/gif' : 'image/jpeg',
      url: `${baseUrl}/public/${config.avatar}`
    }
  }

  // Add alsoKnownAs for identity linking (Nostr, etc.)
  const alsoKnownAs = []
  if (config.nostrPubkey) {
    // Format as did:nostr per https://nostrcg.github.io/did-nostr/
    alsoKnownAs.push(`did:nostr:${config.nostrPubkey}`)
  }
  if (alsoKnownAs.length > 0) {
    actor.alsoKnownAs = alsoKnownAs
  }

  return actor
}

/**
 * Check rate limit
 */
function checkRateLimit(ip) {
  const now = Date.now()
  const record = rateLimits.get(ip)

  if (!record || now - record.start > RATE_LIMIT_WINDOW) {
    rateLimits.set(ip, { start: now, count: 1 })
    return true
  }

  record.count++
  if (record.count > RATE_LIMIT_MAX) {
    return false
  }

  return true
}

/**
 * Clean old rate limit entries (run periodically)
 */
function cleanRateLimits() {
  const now = Date.now()
  for (const [ip, record] of rateLimits) {
    if (now - record.start > RATE_LIMIT_WINDOW) {
      rateLimits.delete(ip)
    }
  }
}

// Clean rate limits every minute
setInterval(cleanRateLimits, RATE_LIMIT_WINDOW)

/**
 * Fetch remote actor (with caching)
 */
async function fetchActor(id) {
  // Strip fragment for fetching
  const fetchUrl = id.replace(/#.*$/, '')
  const cached = getCachedActor(id)
  if (cached) return cached

  try {
    const response = await fetch(fetchUrl, {
      headers: { 'Accept': 'application/activity+json' }
    })
    if (!response.ok) return null

    const actorData = await response.json()
    cacheActor(actorData)
    return actorData
  } catch {
    return null
  }
}

/**
 * Verify HTTP signature on incoming request
 */
async function verifySignature(req, body) {
  const signature = req.headers['signature']
  if (!signature) {
    return { valid: false, reason: 'No signature header' }
  }

  // Parse signature header
  const sigParts = {}
  signature.split(',').forEach(part => {
    const [key, ...rest] = part.split('=')
    sigParts[key.trim()] = rest.join('=').replace(/^"|"$/g, '')
  })

  const keyId = sigParts.keyId
  if (!keyId) {
    return { valid: false, reason: 'No keyId in signature' }
  }

  // Extract actor URL from keyId (strip fragment like #main-key)
  const actorUrl = keyId.replace(/#.*$/, '')

  // Fetch the actor to get their public key
  const remoteActor = await fetchActor(actorUrl)
  if (!remoteActor) {
    return { valid: false, reason: `Could not fetch actor: ${actorUrl}` }
  }

  const publicKeyPem = remoteActor.publicKey?.publicKeyPem
  if (!publicKeyPem) {
    return { valid: false, reason: 'Actor has no public key' }
  }

  // Build the signing string
  const headers = sigParts.headers?.split(' ') || ['(request-target)', 'host', 'date']
  const signingParts = headers.map(header => {
    if (header === '(request-target)') {
      return `(request-target): ${req.method.toLowerCase()} ${req.url}`
    }
    if (header === 'digest' && body) {
      const crypto = require('crypto')
      const digest = crypto.createHash('sha256').update(body).digest('base64')
      return `digest: SHA-256=${digest}`
    }
    return `${header}: ${req.headers[header.toLowerCase()] || ''}`
  })
  const signingString = signingParts.join('\n')

  // Verify the signature
  try {
    const isValid = auth.verify(signingString, sigParts.signature, publicKeyPem)
    return { valid: isValid, actor: remoteActor }
  } catch (err) {
    return { valid: false, reason: `Verification error: ${err.message}` }
  }
}

/**
 * Handle incoming activities
 */
async function handleActivity(activity) {
  console.log(`📥 ${activity.type} from ${activity.actor}`)
  saveActivity(activity)

  switch (activity.type) {
    case 'Follow':
      await handleFollow(activity)
      break
    case 'Undo':
      await handleUndo(activity)
      break
    case 'Accept':
      handleAccept(activity)
      break
    case 'Create':
      console.log(`   📝 New post: ${activity.object?.content?.slice(0, 50)}...`)
      break
    case 'Like':
      console.log(`   ❤️ Liked: ${activity.object}`)
      break
    case 'Announce':
      console.log(`   🔁 Boosted: ${activity.object}`)
      break
  }
}

/**
 * Handle Follow activity
 */
async function handleFollow(activity) {
  const followerActor = await fetchActor(activity.actor)
  if (!followerActor) {
    console.log('   Could not fetch follower actor')
    return
  }

  // Add to followers
  addFollower(activity.actor, followerActor.inbox)
  console.log(`   ✅ New follower: ${followerActor.preferredUsername}`)

  // Send Accept
  const accept = outbox.createAccept(actor.id, activity)

  try {
    await outbox.send({
      activity: accept,
      inbox: followerActor.inbox,
      privateKey: config.privateKey,
      keyId: `${getBaseUrl()}/${config.username}#main-key`
    })
    console.log(`   📤 Sent Accept to ${followerActor.inbox}`)
  } catch (err) {
    console.log(`   ❌ Failed to send Accept: ${err.message}`)
  }
}

/**
 * Handle Undo activity
 */
async function handleUndo(activity) {
  if (activity.object?.type === 'Follow') {
    removeFollower(activity.actor)
    console.log(`   👋 Unfollowed by ${activity.actor}`)
  }
}

/**
 * Handle Accept activity (our follow was accepted)
 */
function handleAccept(activity) {
  if (activity.object?.type === 'Follow') {
    acceptFollowing(activity.object.object)
    console.log(`   ✅ Follow accepted!`)
  }
}

/**
 * Request handler
 */
async function handleRequest(req, res) {
  // Get client IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ||
             req.socket.remoteAddress ||
             'unknown'

  // Check rate limit
  if (!checkRateLimit(ip)) {
    console.log(`🚫 Rate limited: ${ip}`)
    res.writeHead(429, { 'Retry-After': '60' })
    return res.end('Too many requests')
  }

  const url = new URL(req.url, getBaseUrl())
  const path = url.pathname
  const accept = req.headers.accept || ''
  const isAP = accept.includes('activity+json') || accept.includes('ld+json')

  console.log(`${req.method} ${path}`)

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Headers', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')

  if (req.method === 'OPTIONS') {
    res.writeHead(204)
    return res.end()
  }

  // WebFinger
  if (path === '/.well-known/webfinger') {
    const resource = url.searchParams.get('resource')
    const parsed = webfinger.parseResource(resource)

    if (!parsed || parsed.username !== config.username) {
      res.writeHead(404)
      return res.end('Not found')
    }

    // Return /alice#me as the actor (Solid-compatible WebID)
    const profileUrl = `${getBaseUrl()}/${config.username}`
    const response = {
      subject: `acct:${config.username}@${getDomain()}`,
      links: [
        {
          rel: 'self',
          type: 'application/activity+json',
          href: `${profileUrl}#me`
        },
        {
          rel: 'http://webfinger.net/rel/profile-page',
          type: 'text/html',
          href: profileUrl
        }
      ]
    }

    res.setHeader('Content-Type', 'application/jrd+json')
    return res.end(JSON.stringify(response, null, 2))
  }

  // Nodeinfo discovery
  if (path === '/.well-known/nodeinfo') {
    const response = {
      links: [
        {
          rel: 'http://nodeinfo.diaspora.software/ns/schema/2.1',
          href: `${getBaseUrl()}/nodeinfo/2.1`
        }
      ]
    }
    res.setHeader('Content-Type', 'application/json')
    return res.end(JSON.stringify(response, null, 2))
  }

  // Nodeinfo 2.1
  if (path === '/nodeinfo/2.1') {
    const response = {
      version: '2.1',
      software: {
        name: 'fedbox',
        version: '0.0.7',
        repository: 'https://github.com/micro-fed/fedbox'
      },
      protocols: ['activitypub'],
      services: { inbound: [], outbound: [] },
      usage: {
        users: { total: 1, activeMonth: 1, activeHalfyear: 1 },
        localPosts: getPosts(1000).length
      },
      openRegistrations: false,
      metadata: {
        nodeName: config.displayName || config.username,
        nodeDescription: config.summary || 'A Fedbox instance'
      }
    }
    res.setHeader('Content-Type', 'application/json; profile="http://nodeinfo.diaspora.software/ns/schema/2.1#"')
    return res.end(JSON.stringify(response, null, 2))
  }

  // Shared inbox
  if (path === '/inbox') {
    return handleInbox(req, res)
  }

  // Profile routes: /alice, /alice/inbox, /alice/outbox, etc.
  if (path === `/${config.username}`) {
    if (isAP) {
      // Return Actor JSON-LD
      res.setHeader('Content-Type', 'application/activity+json')
      return res.end(JSON.stringify(actor, null, 2))
    } else {
      // Return HTML with embedded JSON-LD
      res.setHeader('Content-Type', 'text/html')
      return res.end(renderProfile())
    }
  }

  // Profile edit
  if (path === `/${config.username}/edit` && req.method === 'POST') {
    return handleProfileEdit(req, res)
  }

  // Inbox
  if (path === `/${config.username}/inbox`) {
    return handleInbox(req, res)
  }

  // Outbox
  if (path === `/${config.username}/outbox`) {
    const posts = getPosts(20)
    const profileUrl = `${getBaseUrl()}/${config.username}`
    const collection = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'OrderedCollection',
      id: `${profileUrl}/outbox`,
      totalItems: posts.length,
      orderedItems: posts.map(p => ({
        type: 'Create',
        actor: `${profileUrl}#me`,
        published: p.published,
        object: {
          type: 'Note',
          id: p.id,
          content: p.content,
          published: p.published,
          attributedTo: `${profileUrl}#me`,
          to: ['https://www.w3.org/ns/activitystreams#Public'],
          cc: [`${profileUrl}/followers`],
          ...(p.in_reply_to ? { inReplyTo: p.in_reply_to } : {})
        }
      }))
    }
    res.setHeader('Content-Type', 'application/activity+json')
    return res.end(JSON.stringify(collection, null, 2))
  }

  // Followers
  if (path === `/${config.username}/followers`) {
    const followers = getFollowers()
    const profileUrl = `${getBaseUrl()}/${config.username}`
    const collection = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'OrderedCollection',
      id: `${profileUrl}/followers`,
      totalItems: followers.length,
      orderedItems: followers.map(f => f.actor)
    }
    res.setHeader('Content-Type', 'application/activity+json')
    return res.end(JSON.stringify(collection, null, 2))
  }

  // Following
  if (path === `/${config.username}/following`) {
    const profileUrl = `${getBaseUrl()}/${config.username}`
    const collection = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'OrderedCollection',
      id: `${profileUrl}/following`,
      totalItems: getFollowingCount(),
      orderedItems: []
    }
    res.setHeader('Content-Type', 'application/activity+json')
    return res.end(JSON.stringify(collection, null, 2))
  }

  // Individual post: /alice/posts/123
  const postMatch = path.match(new RegExp(`^/${config.username}/posts/(\\d+)$`))
  if (postMatch) {
    const postId = `${getBaseUrl()}${path}`
    const post = getPost(postId)
    if (!post) {
      res.writeHead(404)
      return res.end('Not found')
    }

    const profileUrl = `${getBaseUrl()}/${config.username}`
    const note = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'Note',
      id: post.id,
      attributedTo: `${profileUrl}#me`,
      content: post.content,
      published: post.published,
      to: ['https://www.w3.org/ns/activitystreams#Public'],
      cc: [`${profileUrl}/followers`]
    }
    if (post.in_reply_to) {
      note.inReplyTo = post.in_reply_to
    }

    if (isAP) {
      res.setHeader('Content-Type', 'application/activity+json')
      return res.end(JSON.stringify(note, null, 2))
    } else {
      res.setHeader('Content-Type', 'text/html')
      return res.end(renderPost(post, note))
    }
  }

  // Home
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html')
    return res.end(renderHome())
  }

  // Static files from /public/
  if (path.startsWith('/public/')) {
    const filePath = join(process.cwd(), path)
    if (existsSync(filePath)) {
      const ext = extname(filePath)
      const mimeTypes = {
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.html': 'text/html',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml'
      }
      res.setHeader('Content-Type', mimeTypes[ext] || 'text/plain')
      return res.end(readFileSync(filePath))
    }
  }

  res.writeHead(404)
  res.end('Not found')
}

/**
 * Handle inbox POST
 */
async function handleInbox(req, res) {
  if (req.method !== 'POST') {
    res.writeHead(405)
    return res.end('Method not allowed')
  }

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks).toString()

  // Verify signature
  const sigResult = await verifySignature(req, body)
  if (!sigResult.valid) {
    console.log(`   ⚠️  Signature: ${sigResult.reason}`)
  } else {
    console.log(`   🔐 Signature verified`)
  }

  try {
    const activity = JSON.parse(body)
    await handleActivity(activity)
    res.writeHead(202)
    return res.end()
  } catch (err) {
    console.error('Inbox error:', err)
    res.writeHead(400)
    return res.end('Bad request')
  }
}

/**
 * Handle profile edit POST (multipart form data)
 */
async function handleProfileEdit(req, res) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks)

  // Parse multipart form data
  const contentType = req.headers['content-type'] || ''
  const boundary = contentType.split('boundary=')[1]

  if (!boundary) {
    res.writeHead(400)
    return res.end('Bad request')
  }

  const parts = parseMultipart(body, boundary)
  let updated = false

  // Update display name
  if (parts.displayName !== undefined) {
    config.displayName = parts.displayName
    updated = true
  }

  // Update summary
  if (parts.summary !== undefined) {
    config.summary = parts.summary
    updated = true
  }

  // Update nostr pubkey
  if (parts.nostrPubkey !== undefined) {
    config.nostrPubkey = parts.nostrPubkey || undefined
    updated = true
  }

  // Handle avatar upload
  if (parts.avatar && parts.avatar.data && parts.avatar.data.length > 0) {
    // Ensure public directory exists
    if (!existsSync('public')) {
      mkdirSync('public', { recursive: true })
    }

    // Determine file extension from content type
    const ext = parts.avatar.contentType?.includes('png') ? 'png' :
                parts.avatar.contentType?.includes('gif') ? 'gif' : 'jpg'
    const filename = `avatar.${ext}`

    writeFileSync(join('public', filename), parts.avatar.data)
    config.avatar = filename
    updated = true
    console.log(`📷 Avatar saved: public/${filename}`)
  }

  if (updated) {
    // Save config
    writeFileSync('fedbox.json', JSON.stringify(config, null, 2))
    // Rebuild actor with new config
    actor = buildActor()
    console.log('✅ Profile updated')
  }

  res.writeHead(200)
  res.end('OK')
}

/**
 * Parse multipart form data
 */
function parseMultipart(body, boundary) {
  const parts = {}
  const boundaryBuffer = Buffer.from('--' + boundary)
  const crlf = Buffer.from('\r\n')
  const doubleCrlf = Buffer.from('\r\n\r\n')

  let start = 0
  while (true) {
    // Find next boundary
    const boundaryPos = body.indexOf(boundaryBuffer, start)
    if (boundaryPos === -1) break

    // Check for end boundary
    const afterBoundary = boundaryPos + boundaryBuffer.length
    if (body.slice(afterBoundary, afterBoundary + 2).toString() === '--') break

    // Find headers end
    const headersEnd = body.indexOf(doubleCrlf, afterBoundary)
    if (headersEnd === -1) break

    const headers = body.slice(afterBoundary + 2, headersEnd).toString()

    // Find next boundary for content end
    const nextBoundary = body.indexOf(boundaryBuffer, headersEnd)
    const content = body.slice(headersEnd + 4, nextBoundary - 2) // -2 for CRLF before boundary

    // Parse headers
    const nameMatch = headers.match(/name="([^"]+)"/)
    const filenameMatch = headers.match(/filename="([^"]+)"/)
    const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/)

    if (nameMatch) {
      const name = nameMatch[1]
      if (filenameMatch) {
        // File upload
        parts[name] = {
          filename: filenameMatch[1],
          contentType: contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream',
          data: content
        }
      } else {
        // Regular field
        parts[name] = content.toString()
      }
    }

    start = nextBoundary
  }

  return parts
}

/**
 * Render HTML profile with embedded JSON-LD and inline editing
 */
function renderProfile() {
  const followers = getFollowerCount()
  const following = getFollowingCount()
  const posts = getPosts(10)
  const profileUrl = `${getBaseUrl()}/${config.username}`
  const avatarUrl = config.avatar ? `/public/${config.avatar}` : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${config.displayName} (@${config.username}@${getDomain()})</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="alternate" type="application/activity+json" href="${profileUrl}">
  <script type="application/ld+json" id="profile">
${JSON.stringify(actor, null, 2)}
  </script>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 0 auto;
      padding: 2rem;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
    }
    .card {
      background: #16213e;
      border-radius: 16px;
      padding: 2rem;
      text-align: center;
      margin-bottom: 1.5rem;
      position: relative;
    }
    .edit-btn {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: #667eea;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .edit-btn:hover { background: #5a6fd6; }
    .avatar {
      width: 120px;
      height: 120px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea, #764ba2);
      margin: 0 auto 1rem;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 3rem;
      overflow: hidden;
      cursor: pointer;
      position: relative;
    }
    .avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .avatar-overlay {
      display: none;
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.5);
      align-items: center;
      justify-content: center;
      font-size: 1rem;
    }
    .editing .avatar-overlay { display: flex; }
    .avatar-input { display: none; }
    h1 { margin: 0 0 0.5rem; }
    .handle { color: #888; margin-bottom: 1rem; }
    .bio { color: #aaa; margin-bottom: 1.5rem; }
    .stats { display: flex; justify-content: center; gap: 2rem; }
    .stat { text-align: center; }
    .stat-num { font-size: 1.5rem; font-weight: bold; }
    .stat-label { color: #888; font-size: 0.9rem; }
    .badge {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 0.5rem 1rem;
      border-radius: 20px;
      margin-top: 1.5rem;
      font-size: 0.9rem;
    }
    .posts { margin-top: 1rem; }
    .post {
      background: #16213e;
      border-radius: 12px;
      padding: 1rem;
      margin-bottom: 1rem;
    }
    .post-content { margin-bottom: 0.5rem; }
    .post-meta { color: #666; font-size: 0.8rem; }
    .post a { color: #667eea; text-decoration: none; }
    /* Edit mode */
    .edit-input {
      background: #0f172a;
      border: 1px solid #667eea;
      color: #eee;
      padding: 0.5rem;
      border-radius: 8px;
      font-size: inherit;
      text-align: center;
      width: 100%;
      max-width: 300px;
    }
    .edit-input:focus { outline: none; border-color: #818cf8; }
    .edit-textarea {
      background: #0f172a;
      border: 1px solid #667eea;
      color: #aaa;
      padding: 0.5rem;
      border-radius: 8px;
      font-size: 1rem;
      text-align: center;
      width: 100%;
      max-width: 400px;
      resize: vertical;
      min-height: 60px;
    }
    .edit-actions {
      display: none;
      gap: 0.5rem;
      justify-content: center;
      margin-top: 1rem;
    }
    .editing .edit-actions { display: flex; }
    .save-btn {
      background: #22c55e;
      color: white;
      border: none;
      padding: 0.5rem 1.5rem;
      border-radius: 8px;
      cursor: pointer;
    }
    .cancel-btn {
      background: #64748b;
      color: white;
      border: none;
      padding: 0.5rem 1.5rem;
      border-radius: 8px;
      cursor: pointer;
    }
    .view-mode { display: block; }
    .edit-mode { display: none; }
    .editing .view-mode { display: none; }
    .editing .edit-mode { display: block; }
    .editing .edit-btn { display: none; }
  </style>
</head>
<body>
  <div class="card" id="profile-card">
    <button class="edit-btn" onclick="toggleEdit()">Edit</button>

    <div class="avatar" onclick="document.getElementById('avatar-input').click()">
      ${avatarUrl ? `<img src="${avatarUrl}" alt="avatar">` : '📦'}
      <div class="avatar-overlay">Change</div>
    </div>
    <input type="file" id="avatar-input" class="avatar-input" accept="image/*" onchange="previewAvatar(this)">

    <div class="view-mode">
      <h1>${config.displayName}</h1>
    </div>
    <div class="edit-mode">
      <input type="text" class="edit-input" id="edit-name" value="${config.displayName}" placeholder="Display Name">
    </div>

    <p class="handle">@${config.username}@${getDomain()}</p>

    <div class="view-mode">
      ${config.summary ? `<p class="bio">${config.summary}</p>` : '<p class="bio" style="opacity:0.5">No bio yet</p>'}
    </div>
    <div class="edit-mode">
      <textarea class="edit-textarea" id="edit-summary" placeholder="Write a short bio...">${config.summary || ''}</textarea>
    </div>

    ${config.nostrPubkey ? `<p class="nostr-link view-mode" style="margin-bottom:1rem"><a href="nostr:${config.nostrPubkey}" style="color:#667eea;font-size:0.85rem">did:nostr:${config.nostrPubkey.slice(0,8)}...</a></p>` : ''}
    <div class="edit-mode" style="margin-bottom:1rem">
      <input type="text" class="edit-input" id="edit-nostr" value="${config.nostrPubkey || ''}" placeholder="Nostr pubkey (64-char hex)" style="font-size:0.85rem;max-width:400px">
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-num">${followers}</div>
        <div class="stat-label">Followers</div>
      </div>
      <div class="stat">
        <div class="stat-num">${following}</div>
        <div class="stat-label">Following</div>
      </div>
      <div class="stat">
        <div class="stat-num">${posts.length}</div>
        <div class="stat-label">Posts</div>
      </div>
    </div>

    <div class="edit-actions">
      <button class="save-btn" onclick="saveProfile()">Save</button>
      <button class="cancel-btn" onclick="toggleEdit()">Cancel</button>
    </div>

    <div class="badge">📦 Powered by Fedbox</div>
  </div>

  ${posts.length > 0 ? `
  <div class="posts">
    ${posts.map(p => `
    <div class="post">
      <div class="post-content">${p.content}</div>
      <div class="post-meta">
        <a href="${p.id}">${new Date(p.published).toLocaleString()}</a>
      </div>
    </div>
    `).join('')}
  </div>
  ` : ''}

  <script>
    let avatarFile = null;

    function toggleEdit() {
      document.getElementById('profile-card').classList.toggle('editing');
      avatarFile = null;
    }

    function previewAvatar(input) {
      if (input.files && input.files[0]) {
        avatarFile = input.files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
          const avatar = document.querySelector('.avatar');
          avatar.innerHTML = '<img src="' + e.target.result + '" alt="avatar"><div class="avatar-overlay">Change</div>';
        };
        reader.readAsDataURL(input.files[0]);
      }
    }

    async function saveProfile() {
      const formData = new FormData();
      formData.append('displayName', document.getElementById('edit-name').value);
      formData.append('summary', document.getElementById('edit-summary').value);
      formData.append('nostrPubkey', document.getElementById('edit-nostr').value);
      if (avatarFile) {
        formData.append('avatar', avatarFile);
      }

      try {
        const res = await fetch('/${config.username}/edit', {
          method: 'POST',
          body: formData
        });
        if (res.ok) {
          location.reload();
        } else {
          alert('Failed to save');
        }
      } catch (err) {
        alert('Error: ' + err.message);
      }
    }
  </script>
</body>
</html>`
}

/**
 * Render individual post with embedded JSON-LD
 */
function renderPost(post, note) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Post by ${config.displayName}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="alternate" type="application/activity+json" href="${post.id}">
  <script type="application/ld+json">
${JSON.stringify(note, null, 2)}
  </script>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 0 auto;
      padding: 2rem;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
    }
    .post {
      background: #16213e;
      border-radius: 16px;
      padding: 2rem;
    }
    .author {
      display: flex;
      align-items: center;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .avatar {
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(135deg, #667eea, #764ba2);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.5rem;
    }
    .author-info a { color: #667eea; text-decoration: none; }
    .author-info p { margin: 0; color: #888; font-size: 0.9rem; }
    .content { font-size: 1.2rem; line-height: 1.6; margin: 1rem 0; }
    .meta { color: #666; font-size: 0.9rem; }
  </style>
</head>
<body>
  <div class="post">
    <div class="author">
      <div class="avatar">📦</div>
      <div class="author-info">
        <a href="/${config.username}">${config.displayName}</a>
        <p>@${config.username}@${getDomain()}</p>
      </div>
    </div>
    <div class="content">${post.content}</div>
    <div class="meta">${new Date(post.published).toLocaleString()}</div>
  </div>
</body>
</html>`
}

/**
 * Render home page
 */
function renderHome() {
  const profileUrl = `${getBaseUrl()}/${config.username}`
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Fedbox</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 600px;
      margin: 0 auto;
      padding: 2rem;
      background: #1a1a2e;
      color: #eee;
    }
    h1 { color: #667eea; }
    a { color: #667eea; }
    code { background: #16213e; padding: 0.2rem 0.4rem; border-radius: 4px; }
    .endpoints { background: #16213e; padding: 1rem; border-radius: 8px; }
    .endpoints li { margin: 0.5rem 0; }
  </style>
</head>
<body>
  <h1>📦 Fedbox</h1>
  <p>Your Fediverse server is running!</p>

  <h2>Your Profile</h2>
  <p><a href="/${config.username}">@${config.username}@${getDomain()}</a></p>

  <h2>Endpoints</h2>
  <ul class="endpoints">
    <li><code>/.well-known/webfinger</code> - Discovery</li>
    <li><code>/${config.username}</code> - Profile (HTML + JSON-LD)</li>
    <li><code>/${config.username}#me</code> - WebID (Actor)</li>
    <li><code>/${config.username}/inbox</code> - Inbox</li>
    <li><code>/${config.username}/outbox</code> - Outbox</li>
    <li><code>/${config.username}/followers</code> - Followers</li>
  </ul>

  <h2>Federation</h2>
  <p>To federate with Mastodon, expose this server via ngrok:</p>
  <code>ngrok http ${config.port}</code>
  <p>Then update <code>fedbox.json</code> with your ngrok domain.</p>
</body>
</html>`
}

/**
 * Start the server
 */
export async function startServer() {
  loadConfig()
  initStore()
  actor = buildActor()

  const server = createServer(handleRequest)

  server.listen(config.port, () => {
    console.log(`
📦 Fedbox is running!

   Profile: http://localhost:${config.port}/${config.username}
   WebID:   http://localhost:${config.port}/${config.username}#me

${config.domain ? `   Federated: https://${config.domain}/${config.username}` : '   ⚠️  Set "domain" in fedbox.json for federation'}

   Press Ctrl+C to stop
`)
  })
}

export default { startServer }
