/**
 * Actions tests
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert'
import { writeFileSync, unlinkSync, existsSync, mkdirSync, rmSync } from 'fs'
import { generateKeypair } from 'microfed/auth'

function setupConfig(domain = null) {
  const { publicKey, privateKey } = generateKeypair()
  const config = {
    username: 'alice',
    displayName: 'Alice',
    summary: 'Test user',
    port: 3000,
    publicKey,
    privateKey
  }
  if (domain) config.domain = domain
  writeFileSync('fedbox.json', JSON.stringify(config, null, 2))
}

function cleanup() {
  if (existsSync('fedbox.json')) unlinkSync('fedbox.json')
  if (existsSync('data/fedbox.db')) unlinkSync('data/fedbox.db')
  try { rmSync('data', { recursive: true }) } catch {}
}

describe('Actions', () => {
  before(() => {
    cleanup()
    if (!existsSync('data')) mkdirSync('data')
    setupConfig()
  })

  after(() => {
    cleanup()
  })

  test('post creates note with Solid-compatible noteId', async () => {
    const { post } = await import('../lib/actions.js')
    const result = await post('Hello world!')

    // noteId should be /alice/posts/xxx (not /alice#me/posts/xxx)
    assert.ok(result.noteId.includes('/alice/posts/'), 'noteId should include /alice/posts/')
    assert.ok(!result.noteId.includes('#me/posts'), 'noteId should not have #me before /posts')
    assert.ok(!result.noteId.includes('#me'), 'noteId should not contain #me at all')
  })

  test('post returns delivery results', async () => {
    const { post } = await import('../lib/actions.js')
    const result = await post('Test delivery')

    assert.ok('delivered' in result, 'result should have delivered stats')
    assert.ok('success' in result.delivered)
    assert.ok('failed' in result.delivered)
  })

  test('myPosts returns saved posts', async () => {
    const { myPosts } = await import('../lib/actions.js')
    const posts = myPosts(10)
    // Should have posts from previous tests
    assert.ok(posts.length >= 1, 'should have at least 1 post')
    assert.ok(posts[0].content, 'post should have content')
    assert.ok(posts[0].id, 'post should have id')
  })

  test('myPosts posts have Solid-compatible URLs', async () => {
    const { myPosts } = await import('../lib/actions.js')
    const posts = myPosts(10)

    for (const post of posts) {
      assert.ok(post.id.includes('/alice/posts/'), 'post id should include /alice/posts/')
      assert.ok(!post.id.includes('#me'), 'post id should not contain #me')
    }
  })
})
