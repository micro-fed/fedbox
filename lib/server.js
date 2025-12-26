/**
 * Pubcrawl Server
 * ActivityPub server using microfed
 */

import { createServer } from 'http'
import { readFileSync, existsSync } from 'fs'
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
  cacheActor,
  getCachedActor
} from './store.js'

let config = null
let actor = null

/**
 * Load configuration
 */
function loadConfig() {
  if (!existsSync('pubcrawl.json')) {
    throw new Error('Not initialized. Run: pubcrawl init')
  }
  config = JSON.parse(readFileSync('pubcrawl.json', 'utf8'))
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
 * Build actor object
 */
function buildActor() {
  const domain = getDomain()
  const protocol = getProtocol()
  const baseUrl = `${protocol}://${domain}`

  return profile.createActor({
    id: `${baseUrl}/users/${config.username}`,
    username: config.username,
    name: config.displayName,
    summary: config.summary ? `<p>${config.summary}</p>` : '',
    publicKey: config.publicKey,
    sharedInbox: `${baseUrl}/inbox`
  })
}

/**
 * Fetch remote actor (with caching)
 */
async function fetchActor(id) {
  const cached = getCachedActor(id)
  if (cached) return cached

  try {
    const response = await fetch(id, {
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
      console.log(`   New post: ${activity.object?.content?.slice(0, 50)}...`)
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
      keyId: `${actor.id}#main-key`
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
  const url = new URL(req.url, `${getProtocol()}://${getDomain()}`)
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

    const response = webfinger.createResponse(
      `${config.username}@${getDomain()}`,
      actor.id,
      { profileUrl: `${getProtocol()}://${getDomain()}/@${config.username}` }
    )

    res.setHeader('Content-Type', 'application/jrd+json')
    return res.end(JSON.stringify(response, null, 2))
  }

  // Actor
  if (path === `/users/${config.username}`) {
    res.setHeader('Content-Type', 'application/activity+json')
    return res.end(JSON.stringify(actor, null, 2))
  }

  // Inbox
  if (path === `/users/${config.username}/inbox` || path === '/inbox') {
    if (req.method !== 'POST') {
      res.writeHead(405)
      return res.end('Method not allowed')
    }

    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString()

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

  // Outbox
  if (path === `/users/${config.username}/outbox`) {
    const posts = getPosts(20)
    const collection = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'OrderedCollection',
      id: `${actor.id}/outbox`,
      totalItems: posts.length,
      orderedItems: posts.map(p => ({
        type: 'Create',
        actor: actor.id,
        object: {
          type: 'Note',
          id: p.id,
          content: p.content,
          published: p.published,
          attributedTo: actor.id
        }
      }))
    }
    res.setHeader('Content-Type', 'application/activity+json')
    return res.end(JSON.stringify(collection, null, 2))
  }

  // Followers
  if (path === `/users/${config.username}/followers`) {
    const followers = getFollowers()
    const collection = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'OrderedCollection',
      id: `${actor.id}/followers`,
      totalItems: followers.length,
      orderedItems: followers.map(f => f.actor)
    }
    res.setHeader('Content-Type', 'application/activity+json')
    return res.end(JSON.stringify(collection, null, 2))
  }

  // Following
  if (path === `/users/${config.username}/following`) {
    const collection = {
      '@context': 'https://www.w3.org/ns/activitystreams',
      type: 'OrderedCollection',
      id: `${actor.id}/following`,
      totalItems: getFollowingCount(),
      orderedItems: []
    }
    res.setHeader('Content-Type', 'application/activity+json')
    return res.end(JSON.stringify(collection, null, 2))
  }

  // HTML Profile
  if (path === `/@${config.username}` || (path === `/users/${config.username}` && !isAP)) {
    res.setHeader('Content-Type', 'text/html')
    return res.end(renderProfile())
  }

  // Home
  if (path === '/') {
    res.setHeader('Content-Type', 'text/html')
    return res.end(renderHome())
  }

  res.writeHead(404)
  res.end('Not found')
}

/**
 * Render HTML profile
 */
function renderProfile() {
  const followers = getFollowerCount()
  const following = getFollowingCount()

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${config.displayName} (@${config.username}@${getDomain()})</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
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
    }
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
    }
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
  </style>
</head>
<body>
  <div class="card">
    <div class="avatar">🍺</div>
    <h1>${config.displayName}</h1>
    <p class="handle">@${config.username}@${getDomain()}</p>
    ${config.summary ? `<p class="bio">${config.summary}</p>` : ''}
    <div class="stats">
      <div class="stat">
        <div class="stat-num">${followers}</div>
        <div class="stat-label">Followers</div>
      </div>
      <div class="stat">
        <div class="stat-num">${following}</div>
        <div class="stat-label">Following</div>
      </div>
    </div>
    <div class="badge">🍺 Powered by Pubcrawl</div>
  </div>
</body>
</html>`
}

/**
 * Render home page
 */
function renderHome() {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Pubcrawl</title>
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
  <h1>🍺 Pubcrawl</h1>
  <p>Your Fediverse server is running!</p>

  <h2>Your Profile</h2>
  <p><a href="/@${config.username}">@${config.username}@${getDomain()}</a></p>

  <h2>Endpoints</h2>
  <ul class="endpoints">
    <li><code>/.well-known/webfinger</code> - Discovery</li>
    <li><code>/users/${config.username}</code> - Actor</li>
    <li><code>/users/${config.username}/inbox</code> - Inbox</li>
    <li><code>/users/${config.username}/outbox</code> - Outbox</li>
    <li><code>/users/${config.username}/followers</code> - Followers</li>
  </ul>

  <h2>Federation</h2>
  <p>To federate with Mastodon, expose this server via ngrok:</p>
  <code>ngrok http ${config.port}</code>
  <p>Then update <code>pubcrawl.json</code> with your ngrok domain.</p>
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
🍺 Pubcrawl is running!

   Profile: http://localhost:${config.port}/@${config.username}
   Actor:   http://localhost:${config.port}/users/${config.username}

${config.domain ? `   Federated: https://${config.domain}/@${config.username}` : '   ⚠️  Set "domain" in pubcrawl.json for federation'}

   Press Ctrl+C to stop
`)
  })
}

export default { startServer }
