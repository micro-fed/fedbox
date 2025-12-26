#!/usr/bin/env node

/**
 * Fedbox CLI
 * Zero to Fediverse in 60 seconds
 */

import { createInterface } from 'readline'
import { existsSync, writeFileSync, mkdirSync, readFileSync, unlinkSync, rmSync } from 'fs'
import { generateKeypair } from 'microfed/auth'

const rl = createInterface({
  input: process.stdin,
  output: process.stdout
})

const ask = (q) => new Promise(resolve => rl.question(q, resolve))

const BANNER = `
╔═══════════════════════════════════════════╗
║                                           ║
║   📦 FEDBOX                               ║
║   Zero to Fediverse in 60 seconds         ║
║                                           ║
╚═══════════════════════════════════════════╝
`

const COMMANDS = {
  init: runInit,
  start: runStart,
  status: runStatus,
  post: runPost,
  follow: runFollow,
  timeline: runTimeline,
  reply: runReply,
  posts: runPosts,
  clean: runClean,
  help: runHelp
}

async function main() {
  const command = process.argv[2] || 'help'
  const handler = COMMANDS[command]

  if (!handler) {
    console.log(`Unknown command: ${command}`)
    runHelp()
    process.exit(1)
  }

  await handler()
}

async function runInit() {
  console.log(BANNER)

  if (existsSync('fedbox.json')) {
    console.log('⚠️  Already initialized. Delete fedbox.json to start over.\n')
    process.exit(1)
  }

  console.log('Let\'s get you on the Fediverse!\n')

  const username = await ask('👤 Username (e.g., alice): ')
  const displayName = await ask('📛 Display name (e.g., Alice): ') || username
  const summary = await ask('📝 Bio (optional): ') || ''
  const port = await ask('🔌 Port (default 3000): ') || '3000'

  console.log('\n🔐 Generating keypair...')
  const { publicKey, privateKey } = generateKeypair()

  const config = {
    username: username.toLowerCase().replace(/[^a-z0-9]/g, ''),
    displayName,
    summary,
    port: parseInt(port),
    publicKey,
    privateKey,
    createdAt: new Date().toISOString()
  }

  if (!existsSync('data')) {
    mkdirSync('data')
  }

  writeFileSync('fedbox.json', JSON.stringify(config, null, 2))
  console.log('✅ Config saved to fedbox.json')

  console.log(`
╔═══════════════════════════════════════════╗
║  ✅ READY!                                ║
╚═══════════════════════════════════════════╝

Next steps:

1. Start your server:
   $ fedbox start

2. Expose with ngrok (for federation):
   $ ngrok http ${port}

3. Update fedbox.json with your ngrok domain

4. Visit your profile:
   http://localhost:${port}/@${config.username}

Happy federating! 📦
`)

  rl.close()
}

async function runStart() {
  if (!existsSync('fedbox.json')) {
    console.log('❌ Not initialized. Run: fedbox init\n')
    process.exit(1)
  }

  console.log('🚀 Starting server...\n')

  const { startServer } = await import('../lib/server.js')
  await startServer()
}

async function runStatus() {
  if (!existsSync('fedbox.json')) {
    console.log('❌ Not initialized. Run: fedbox init\n')
    process.exit(1)
  }

  const config = JSON.parse(readFileSync('fedbox.json', 'utf8'))

  // Get follower/following counts
  let followers = 0, following = 0
  try {
    const { initStore, getFollowerCount, getFollowingCount } = await import('../lib/store.js')
    initStore()
    followers = getFollowerCount()
    following = getFollowingCount()
  } catch {}

  console.log(`
╔═══════════════════════════════════════════╗
║  📊 FEDBOX STATUS                         ║
╚═══════════════════════════════════════════╝

Username:   @${config.username}
Name:       ${config.displayName}
Port:       ${config.port}
Domain:     ${config.domain || '(not set - run with ngrok)'}
Followers:  ${followers}
Following:  ${following}
Created:    ${config.createdAt}
`)

  rl.close()
}

async function runPost() {
  if (!existsSync('fedbox.json')) {
    console.log('❌ Not initialized. Run: fedbox init\n')
    process.exit(1)
  }

  const content = process.argv[3]
  if (!content) {
    console.log('Usage: fedbox post "Your message here"')
    process.exit(1)
  }

  const { post } = await import('../lib/actions.js')

  console.log('📝 Creating post...')
  const result = await post(content)

  console.log(`
✅ Posted!

ID: ${result.noteId}
Content: ${content}
Delivered to: ${result.delivered.success} followers (${result.delivered.failed} failed)
`)

  rl.close()
}

async function runFollow() {
  if (!existsSync('fedbox.json')) {
    console.log('❌ Not initialized. Run: fedbox init\n')
    process.exit(1)
  }

  const handle = process.argv[3]
  if (!handle) {
    console.log('Usage: fedbox follow @user@domain')
    process.exit(1)
  }

  const { follow } = await import('../lib/actions.js')

  try {
    const result = await follow(handle)
    console.log(`
✅ Follow request sent!

User: ${result.actor.preferredUsername || result.actor.name}
Actor: ${result.actor.id}

Waiting for them to accept...
`)
  } catch (err) {
    console.log(`❌ ${err.message}`)
    process.exit(1)
  }

  rl.close()
}

async function runTimeline() {
  if (!existsSync('fedbox.json')) {
    console.log('❌ Not initialized. Run: fedbox init\n')
    process.exit(1)
  }

  const { timeline } = await import('../lib/actions.js')
  const posts = timeline(20)

  if (posts.length === 0) {
    console.log(`
📭 Your timeline is empty.

Follow some people with: fedbox follow @user@domain
`)
    rl.close()
    return
  }

  console.log(`
╔═══════════════════════════════════════════╗
║  📰 TIMELINE                              ║
╚═══════════════════════════════════════════╝
`)

  for (const post of posts) {
    const author = post.author?.split('/').pop() || 'unknown'
    const content = post.content
      .replace(/<[^>]*>/g, '') // Strip HTML
      .slice(0, 200)
    const date = new Date(post.published).toLocaleString()

    console.log(`┌─ @${author} · ${date}`)
    console.log(`│ ${content}`)
    if (post.inReplyTo) {
      console.log(`│ ↩️  Reply to: ${post.inReplyTo}`)
    }
    console.log(`└─ ${post.id}`)
    console.log()
  }

  rl.close()
}

async function runReply() {
  if (!existsSync('fedbox.json')) {
    console.log('❌ Not initialized. Run: fedbox init\n')
    process.exit(1)
  }

  const postUrl = process.argv[3]
  const content = process.argv[4]

  if (!postUrl || !content) {
    console.log('Usage: fedbox reply <post-url> "Your reply"')
    process.exit(1)
  }

  const { reply } = await import('../lib/actions.js')

  console.log('💬 Sending reply...')
  const result = await reply(postUrl, content)

  console.log(`
✅ Reply sent!

ID: ${result.noteId}
In reply to: ${postUrl}
Delivered to: ${result.delivered.success} inboxes
`)

  rl.close()
}

async function runPosts() {
  if (!existsSync('fedbox.json')) {
    console.log('❌ Not initialized. Run: fedbox init\n')
    process.exit(1)
  }

  const { myPosts } = await import('../lib/actions.js')
  const posts = myPosts(20)

  if (posts.length === 0) {
    console.log(`
📭 You haven't posted anything yet.

Create a post with: fedbox post "Hello, Fediverse!"
`)
    rl.close()
    return
  }

  console.log(`
╔═══════════════════════════════════════════╗
║  📝 YOUR POSTS                            ║
╚═══════════════════════════════════════════╝
`)

  for (const post of posts) {
    const date = new Date(post.published).toLocaleString()
    console.log(`┌─ ${date}`)
    console.log(`│ ${post.content}`)
    if (post.in_reply_to) {
      console.log(`│ ↩️  Reply to: ${post.in_reply_to}`)
    }
    console.log(`└─ ${post.id}`)
    console.log()
  }

  rl.close()
}

async function runClean() {
  const all = process.argv[3] === '--all'

  console.log('🧹 Cleaning up...\n')

  // Remove database
  if (existsSync('data/fedbox.db')) {
    unlinkSync('data/fedbox.db')
    console.log('   ✓ Removed data/fedbox.db')
  }

  // Remove data directory if empty
  if (existsSync('data')) {
    try {
      rmSync('data', { recursive: false })
      console.log('   ✓ Removed data/')
    } catch {
      // Directory not empty, that's ok
    }
  }

  // Remove config if --all
  if (all && existsSync('fedbox.json')) {
    unlinkSync('fedbox.json')
    console.log('   ✓ Removed fedbox.json')
  }

  console.log('\n✅ Clean complete!')

  if (!all) {
    console.log('\n   Tip: Use "fedbox clean --all" to also remove config')
  }

  rl.close()
}

function runHelp() {
  console.log(`
${BANNER}
Usage: fedbox <command> [args]

Setup:
  init              Set up a new Fediverse identity
  start             Start the server
  status            Show current configuration

Social:
  post "text"       Post a message to your followers
  follow @user@dom  Follow a remote user
  timeline          View posts from people you follow
  reply <url> "text" Reply to a post
  posts             View your own posts

Other:
  clean             Remove database (add --all to also remove config)
  help              Show this help

Quick start:
  $ fedbox init
  $ fedbox start
  $ fedbox post "Hello, Fediverse!"
  $ fedbox follow @user@mastodon.social

For federation (so Mastodon can find you):
  $ ngrok http 3000
  Then update fedbox.json with your ngrok domain
`)

  rl.close()
}

main().catch(err => {
  console.error('Error:', err.message)
  process.exit(1)
})
