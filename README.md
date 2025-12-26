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
```

That's it. You're on the Fediverse.

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
- **ActivityPub compatible** — Works with Mastodon, Pleroma, Pixelfed, etc.
- **Persistent storage** — SQLite database for followers, posts, activities
- **Beautiful profile page** — Dark theme, looks great
- **Zero config** — Just answer a few questions

## Commands

```bash
fedbox init     # Set up your identity
fedbox start    # Start the server
fedbox status   # Show current config
fedbox help     # Show help
```

## How It Works

Fedbox uses [microfed](https://github.com/micro-fed/microfed.org) for ActivityPub primitives:

- **Profile** — Your actor/identity
- **Inbox** — Receive follows, likes, boosts
- **Outbox** — Your posts
- **WebFinger** — So others can find you

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
