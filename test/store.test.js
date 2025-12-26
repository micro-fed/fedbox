/**
 * Store tests
 */

import { test, describe, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert'
import { unlinkSync, existsSync, mkdirSync } from 'fs'
import {
  initStore,
  getStore,
  addFollower,
  removeFollower,
  getFollowers,
  getFollowerCount,
  addFollowing,
  acceptFollowing,
  getFollowing,
  getFollowingCount,
  savePost,
  getPosts,
  getPost,
  cacheActor,
  getCachedActor,
  saveActivity,
  getActivities
} from '../lib/store.js'

const TEST_DB = 'test/test.db'

function cleanup() {
  if (existsSync(TEST_DB)) {
    unlinkSync(TEST_DB)
  }
}

describe('Store', () => {
  beforeEach(() => {
    cleanup()
    if (!existsSync('test')) mkdirSync('test', { recursive: true })
    initStore(TEST_DB)
  })

  afterEach(() => {
    const db = getStore()
    db.close()
    cleanup()
  })

  test('initStore creates database', () => {
    assert.ok(existsSync(TEST_DB))
  })

  test('getStore returns database instance', () => {
    const db = getStore()
    assert.ok(db)
  })
})

describe('Followers', () => {
  beforeEach(() => {
    cleanup()
    initStore(TEST_DB)
  })

  afterEach(() => {
    const db = getStore()
    db.close()
    cleanup()
  })

  test('addFollower and getFollowers', () => {
    addFollower('https://example.com/user/alice', 'https://example.com/user/alice/inbox')
    const followers = getFollowers()
    assert.strictEqual(followers.length, 1)
    assert.strictEqual(followers[0].actor, 'https://example.com/user/alice')
    assert.strictEqual(followers[0].inbox, 'https://example.com/user/alice/inbox')
  })

  test('getFollowerCount', () => {
    assert.strictEqual(getFollowerCount(), 0)
    addFollower('https://example.com/user/alice', 'https://example.com/inbox')
    assert.strictEqual(getFollowerCount(), 1)
    addFollower('https://example.com/user/bob', 'https://example.com/inbox')
    assert.strictEqual(getFollowerCount(), 2)
  })

  test('removeFollower', () => {
    addFollower('https://example.com/user/alice', 'https://example.com/inbox')
    assert.strictEqual(getFollowerCount(), 1)
    removeFollower('https://example.com/user/alice')
    assert.strictEqual(getFollowerCount(), 0)
  })
})

describe('Following', () => {
  beforeEach(() => {
    cleanup()
    initStore(TEST_DB)
  })

  afterEach(() => {
    const db = getStore()
    db.close()
    cleanup()
  })

  test('addFollowing with pending status', () => {
    addFollowing('https://example.com/user/bob', false)
    assert.strictEqual(getFollowingCount(), 0) // Not accepted yet
  })

  test('acceptFollowing', () => {
    addFollowing('https://example.com/user/bob', false)
    assert.strictEqual(getFollowingCount(), 0)
    acceptFollowing('https://example.com/user/bob')
    assert.strictEqual(getFollowingCount(), 1)
  })

  test('getFollowing returns only accepted', () => {
    addFollowing('https://example.com/user/bob', false)
    addFollowing('https://example.com/user/charlie', true)
    const following = getFollowing()
    assert.strictEqual(following.length, 1)
    assert.strictEqual(following[0].actor, 'https://example.com/user/charlie')
  })
})

describe('Posts', () => {
  beforeEach(() => {
    cleanup()
    initStore(TEST_DB)
  })

  afterEach(() => {
    const db = getStore()
    db.close()
    cleanup()
  })

  test('savePost and getPost', () => {
    const id = 'https://example.com/alice/posts/123'
    savePost(id, 'Hello world!')
    const post = getPost(id)
    assert.ok(post)
    assert.strictEqual(post.id, id)
    assert.strictEqual(post.content, 'Hello world!')
  })

  test('savePost with inReplyTo', () => {
    const id = 'https://example.com/alice/posts/456'
    const replyTo = 'https://other.com/posts/789'
    savePost(id, 'This is a reply', replyTo)
    const post = getPost(id)
    assert.strictEqual(post.in_reply_to, replyTo)
  })

  test('getPosts returns posts', () => {
    savePost('https://example.com/posts/1', 'First')
    savePost('https://example.com/posts/2', 'Second')
    savePost('https://example.com/posts/3', 'Third')
    const posts = getPosts(10)
    assert.strictEqual(posts.length, 3)
    // All posts should be present
    const contents = posts.map(p => p.content)
    assert.ok(contents.includes('First'))
    assert.ok(contents.includes('Second'))
    assert.ok(contents.includes('Third'))
  })

  test('getPosts respects limit', () => {
    for (let i = 0; i < 10; i++) {
      savePost(`https://example.com/posts/${i}`, `Post ${i}`)
    }
    const posts = getPosts(5)
    assert.strictEqual(posts.length, 5)
  })
})

describe('Actor Cache', () => {
  beforeEach(() => {
    cleanup()
    initStore(TEST_DB)
  })

  afterEach(() => {
    const db = getStore()
    db.close()
    cleanup()
  })

  test('cacheActor and getCachedActor', () => {
    const actor = {
      id: 'https://example.com/user/alice',
      type: 'Person',
      preferredUsername: 'alice'
    }
    cacheActor(actor)
    const cached = getCachedActor(actor.id)
    assert.deepStrictEqual(cached, actor)
  })

  test('getCachedActor returns null for unknown', () => {
    const cached = getCachedActor('https://example.com/unknown')
    assert.strictEqual(cached, null)
  })
})

describe('Activities', () => {
  beforeEach(() => {
    cleanup()
    initStore(TEST_DB)
  })

  afterEach(() => {
    const db = getStore()
    db.close()
    cleanup()
  })

  test('saveActivity and getActivities', () => {
    const activity = {
      id: 'https://example.com/activity/1',
      type: 'Create',
      actor: 'https://example.com/user/alice',
      object: { type: 'Note', content: 'Hello' }
    }
    saveActivity(activity)
    const activities = getActivities(10)
    assert.strictEqual(activities.length, 1)
    assert.strictEqual(activities[0].type, 'Create')
    assert.deepStrictEqual(activities[0].raw, activity)
  })
})
