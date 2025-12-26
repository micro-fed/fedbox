#!/usr/bin/env node

/**
 * Pubcrawl CLI
 * Zero to Fediverse in 60 seconds
 */

import { createInterface } from 'readline'
import { existsSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
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

  // Check if already initialized
  if (existsSync('fedbox.json')) {
    console.log('⚠️  Already initialized. Delete fedbox.json to start over.\n')
    process.exit(1)
  }

  console.log('Let\'s get you on the Fediverse!\n')

  // Gather info
  const username = await ask('👤 Username (e.g., alice): ')
  const displayName = await ask('📛 Display name (e.g., Alice): ') || username
  const summary = await ask('📝 Bio (optional): ') || ''
  const port = await ask('🔌 Port (default 3000): ') || '3000'

  console.log('\n🔐 Generating keypair...')
  const { publicKey, privateKey } = generateKeypair()

  // Create config
  const config = {
    username: username.toLowerCase().replace(/[^a-z0-9]/g, ''),
    displayName,
    summary,
    port: parseInt(port),
    publicKey,
    privateKey,
    createdAt: new Date().toISOString()
  }

  // Create data directory
  if (!existsSync('data')) {
    mkdirSync('data')
  }

  // Save config
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

  // Dynamic import to avoid loading before init
  const { startServer } = await import('../lib/server.js')
  await startServer()
}

async function runStatus() {
  if (!existsSync('fedbox.json')) {
    console.log('❌ Not initialized. Run: fedbox init\n')
    process.exit(1)
  }

  const config = JSON.parse(await import('fs').then(fs =>
    fs.readFileSync('fedbox.json', 'utf8')
  ))

  console.log(`
╔═══════════════════════════════════════════╗
║  📊 FEDBOX STATUS                         ║
╚═══════════════════════════════════════════╝

Username:  @${config.username}
Name:      ${config.displayName}
Port:      ${config.port}
Domain:    ${config.domain || '(not set - run with ngrok)'}
Created:   ${config.createdAt}
`)

  rl.close()
}

function runHelp() {
  console.log(`
${BANNER}
Usage: fedbox <command>

Commands:
  init      Set up a new Fediverse identity
  start     Start the server
  status    Show current configuration
  help      Show this help

Quick start:
  $ fedbox init
  $ fedbox start

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
