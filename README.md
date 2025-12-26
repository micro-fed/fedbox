# 📦 Fedbox

**Zero to Fediverse in 60 seconds.**

Fedbox is the fastest way to get your own identity on the Fediverse. Run your own ActivityPub server, federate with Mastodon, and own your social presence.

## Quick Start

```bash
# Install
npm install -g fedbox

# Set up your identity
fedbox init

# Start your server
fedbox start

# Post something!
fedbox post "Hello, Fediverse!"
```

That's it. You're on the Fediverse.

## Commands

```bash
# Setup
fedbox init           # Set up your identity
fedbox start          # Start the server
fedbox status         # Show your profile info

# Social
fedbox post "text"    # Post a message to followers
fedbox follow @user@domain  # Follow someone
fedbox timeline       # View posts from people you follow
fedbox reply <url> "text"   # Reply to a post
fedbox posts          # View your own posts

# Help
fedbox help           # Show all commands
```

## Federation (so Mastodon can find you)

To federate with the wider Fediverse, you need a public HTTPS URL. The easiest way:

```bash
# In another terminal
ngrok http 3000
```

Copy your ngrok URL (e.g., `abc123.ngrok.io`) and add it to `fedbox.json`:

```json
{
  "domain": "abc123.ngrok.io",
  ...
}
```

Restart your server, and you're federated! Search for `@yourname@abc123.ngrok.io` on Mastodon.

## What You Get

- **Your own identity** — `@you@yourdomain.com`
- **Post from CLI** — `fedbox post "Hello world"`
- **Follow anyone** — `fedbox follow @user@mastodon.social`
- **View timeline** — `fedbox timeline`
- **Reply to posts** — `fedbox reply <url> "Nice!"`
- **ActivityPub compatible** — Works with Mastodon, Pleroma, Pixelfed, etc.
- **HTTP Signature verification** — Secure federation
- **Rate limiting** — Protection against abuse
- **Persistent storage** — SQLite database
- **Beautiful profile page** — Dark theme, shows your posts

## How It Works

Fedbox uses [microfed](https://github.com/micro-fed/microfed.org) for ActivityPub primitives:

- **Profile** — Your actor/identity
- **Inbox** — Receive follows, likes, boosts, posts
- **Outbox** — Your posts
- **WebFinger** — So others can find you
- **HTTP Signatures** — Secure signed requests

Data is stored in SQLite (`data/fedbox.db`).

## Configuration

After `fedbox init`, you'll have a `fedbox.json`:

```json
{
  "username": "alice",
  "displayName": "Alice",
  "summary": "Hello, Fediverse!",
  "port": 3000,
  "domain": null,
  "publicKey": "...",
  "privateKey": "..."
}
```

Add `"domain"` for federation with the wider Fediverse.

## Requirements

- Node.js 18+
- For federation: ngrok or a public server with HTTPS

## License

MIT

---

**Built with [microfed](https://github.com/micro-fed/microfed.org). Happy federating! 📦**
