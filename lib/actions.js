/**
 * Fedbox Actions
 * User actions: post, follow, reply, timeline
 */

import { readFileSync } from 'fs'
import { outbox, webfinger } from 'microfed'
import {
  initStore,
  savePost,
  getPosts,
  getPost,
  getFollowers,
  getFollowing,
  addFollowing,
  getActivities,
  cacheActor,
  getCachedActor
} from './store.js'

let config = null

/**
 * Load config
 */
function loadConfig() {
  config = JSON.parse(readFileSync('fedbox.json', 'utf8'))
  return config
}

/**
 * Get base URL
 */
function getBaseUrl() {
  const domain = config.domain || `localhost:${config.port}`
  const protocol = config.domain ? 'https' : 'http'
  return `${protocol}://${domain}`
}

/**
 * Get profile URL (the document)
 */
function getProfileUrl() {
  return `${getBaseUrl()}/${config.username}`
}

/**
 * Get actor URL (WebID with #me fragment)
 */
function getActorUrl() {
  return `${getProfileUrl()}#me`
}

/**
 * Fetch remote actor
 */
async function fetchActor(id) {
  const cached = getCachedActor(id)
  if (cached) return cached

  try {
    const response = await fetch(id, {
      headers: { 'Accept': 'application/activity+json' }
    })
    if (!response.ok) return null
    const actor = await response.json()
    cacheActor(actor)
    return actor
  } catch {
    return null
  }
}

/**
 * Post a note to followers
 */
export async function post(content, inReplyTo = null) {
  loadConfig()
  initStore()

  const actorUrl = getActorUrl()
  const profileUrl = getProfileUrl()
  const noteId = `${profileUrl}/posts/${Date.now()}`

  // Create the Note
  const note = outbox.createNote(actorUrl, content, {
    id: noteId,
    inReplyTo,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [`${profileUrl}/followers`]
  })

  // Wrap in Create activity
  const create = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Create',
    id: `${noteId}/activity`,
    actor: actorUrl,
    published: new Date().toISOString(),
    to: note.to,
    cc: note.cc,
    object: note
  }

  // Save to local posts
  savePost(noteId, content, inReplyTo)

  // Deliver to all followers
  const followers = getFollowers()
  const results = { success: 0, failed: 0 }

  for (const follower of followers) {
    if (!follower.inbox) continue
    try {
      await outbox.send({
        activity: create,
        inbox: follower.inbox,
        privateKey: config.privateKey,
        keyId: `${profileUrl}#main-key`
      })
      results.success++
    } catch (err) {
      results.failed++
    }
  }

  return { noteId, note, delivered: results }
}

/**
 * Follow a remote user
 */
export async function follow(handle) {
  loadConfig()
  initStore()

  // Parse handle (@user@domain or user@domain)
  const cleanHandle = handle.replace(/^@/, '')
  const [username, domain] = cleanHandle.split('@')

  if (!username || !domain) {
    throw new Error('Invalid handle. Use format: @user@domain or user@domain')
  }

  // Resolve via WebFinger
  console.log(`🔍 Looking up ${cleanHandle}...`)
  const resolved = await webfinger.resolve(username, domain)

  if (!resolved) {
    throw new Error(`Could not find ${cleanHandle}`)
  }

  // Fetch the actor
  console.log(`📥 Fetching actor...`)
  const remoteActor = await fetchActor(resolved.actorId)

  if (!remoteActor) {
    throw new Error(`Could not fetch actor: ${resolved.actorId}`)
  }

  const actorUrl = getActorUrl()
  const profileUrl = getProfileUrl()
  const inbox = remoteActor.inbox

  // Create Follow activity
  const followActivity = outbox.createFollow(actorUrl, remoteActor.id)

  // Send Follow
  console.log(`📤 Sending Follow to ${inbox}...`)
  await outbox.send({
    activity: followActivity,
    inbox,
    privateKey: config.privateKey,
    keyId: `${profileUrl}#main-key`
  })

  // Save to following (pending acceptance)
  addFollowing(remoteActor.id, false)

  return {
    actor: remoteActor,
    followActivity
  }
}

/**
 * Reply to a post
 */
export async function reply(postUrl, content) {
  loadConfig()
  initStore()

  // Fetch the original post to get the author
  let originalAuthor = null
  try {
    const response = await fetch(postUrl, {
      headers: { 'Accept': 'application/activity+json' }
    })
    if (response.ok) {
      const post = await response.json()
      originalAuthor = post.attributedTo
    }
  } catch {
    // Continue without original author
  }

  const actorUrl = getActorUrl()
  const profileUrl = getProfileUrl()
  const noteId = `${profileUrl}/posts/${Date.now()}`

  // Create the reply Note
  const note = outbox.createNote(actorUrl, content, {
    id: noteId,
    inReplyTo: postUrl,
    to: ['https://www.w3.org/ns/activitystreams#Public'],
    cc: [`${profileUrl}/followers`, originalAuthor].filter(Boolean)
  })

  // Wrap in Create activity
  const create = {
    '@context': 'https://www.w3.org/ns/activitystreams',
    type: 'Create',
    id: `${noteId}/activity`,
    actor: actorUrl,
    published: new Date().toISOString(),
    to: note.to,
    cc: note.cc,
    object: note
  }

  // Save locally
  savePost(noteId, content, postUrl)

  // Collect inboxes to deliver to
  const inboxes = new Set()

  // Add all followers
  const followers = getFollowers()
  for (const f of followers) {
    if (f.inbox) inboxes.add(f.inbox)
  }

  // Add original author's inbox
  if (originalAuthor) {
    const authorActor = await fetchActor(originalAuthor)
    if (authorActor?.inbox) {
      inboxes.add(authorActor.inbox)
    }
  }

  // Deliver
  const results = { success: 0, failed: 0 }
  for (const inbox of inboxes) {
    try {
      await outbox.send({
        activity: create,
        inbox,
        privateKey: config.privateKey,
        keyId: `${profileUrl}#main-key`
      })
      results.success++
    } catch {
      results.failed++
    }
  }

  return { noteId, note, delivered: results }
}

/**
 * Get timeline (posts from people we follow + mentions)
 */
export function timeline(limit = 20) {
  loadConfig()
  initStore()

  // Get Create activities from inbox
  const activities = getActivities(100)

  const posts = activities
    .filter(a => a.type === 'Create' && a.raw?.object)
    .map(a => {
      const obj = a.raw.object
      return {
        id: obj.id || a.id,
        author: typeof a.raw.actor === 'string' ? a.raw.actor : a.raw.actor?.id,
        content: obj.content || '',
        published: obj.published || a.created_at,
        inReplyTo: obj.inReplyTo
      }
    })
    .slice(0, limit)

  return posts
}

/**
 * Get our own posts
 */
export function myPosts(limit = 20) {
  loadConfig()
  initStore()
  return getPosts(limit)
}

export default {
  post,
  follow,
  reply,
  timeline,
  myPosts
}
