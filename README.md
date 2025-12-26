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
fedbox init             # Set up your identity
fedbox start            # Start full ActivityPub server
fedbox profile [port]   # Start profile-only server (for editing)
fedbox status           # Show your profile info

# Social
fedbox post "text"      # Post a message to followers
fedbox follow @user@domain  # Follow someone
fedbox timeline         # View posts from people you follow
fedbox reply <url> "text"   # Reply to a post
fedbox posts            # View your own posts

# Maintenance
fedbox clean            # Remove database
fedbox clean --all      # Remove database and config
fedbox help             # Show all commands
```

## Profile Editing (Web UI)

Visit your profile page and click **Edit** to change:
- Display name
- Bio
- Avatar (upload image)
- Nostr pubkey (64-char hex)

```bash
fedbox profile
# Visit http://localhost:3000/
# Click "Edit" to modify your profile
```

## Nostr Identity

Link your Nostr identity by adding your pubkey (64-char hex):

```json
{
  "nostrPubkey": "124c0fa99407182ece5a24fad9b7f6674902fc422843d3128d38a0afbee0fdd2"
}
```

Your actor will include:
```json
{
  "alsoKnownAs": ["did:nostr:124c0fa99407182ece5a24fad9b7f6674902fc422843d3128d38a0afbee0fdd2"]
}
```

This follows the [did:nostr spec](https://nostrcg.github.io/did-nostr/).

## Solid-Compatible URIs

Fedbox uses Solid-style WebID URIs:

- `/alice` — Profile document (HTML + JSON-LD)
- `/alice#me` — WebID (the Person/Actor)

This makes profiles compatible with both ActivityPub and Solid ecosystems.

## Separated Architecture

Fedbox supports separating **identity** (profile) from **federation** (AP server):

```
Profile Server (static host)         AP Server (fedbox)
───────────────────────────          ─────────────────
https://me.example.com               https://fedbox.example.com
    /alice                               /alice/inbox
    /alice#me  ──points to──►            /alice/outbox
                                         /alice/followers
```

**Profile-only config** (`fedbox.json`):
```json
{
  "username": "alice",
  "displayName": "Alice",
  "summary": "My bio",
  "apServer": "https://fedbox.example.com",
  "nostrPubkey": "124c0fa9..."
}
```

The profile can be hosted anywhere (GitHub Pages, S3, any static server). The AP server handles federation.

## Remote Profile via Data Island

Fedbox can fetch your identity from a remote static HTML page containing a JSON-LD data island:

**Static HTML profile** (hosted anywhere):
```html
<!DOCTYPE html>
<html>
<head>
  <script type="application/ld+json">
  {
    "@context": ["https://www.w3.org/ns/activitystreams", "https://w3id.org/security/v1"],
    "type": "Person",
    "id": "https://me.example.com/alice#me",
    "preferredUsername": "alice",
    "name": "Alice",
    "publicKey": {
      "id": "https://me.example.com/alice#main-key",
      "publicKeyPem": "-----BEGIN PUBLIC KEY-----..."
    }
  }
  </script>
</head>
<body>...</body>
</html>
```

**Fedbox config** (`fedbox.json`):
```json
{
  "username": "alice",
  "profileUrl": "https://me.example.com/alice",
  "domain": "fedbox.example.com"
}
```

Fedbox extracts the JSON-LD, merges it with local AP endpoints (inbox, outbox, etc.), and serves with proper content negotiation. This allows your identity to live on a static homepage while fedbox handles ActivityPub federation.

## Federation (so Mastodon can find you)

To federate with the wider Fediverse, you need a public HTTPS URL:

```bash
# In another terminal
ngrok http 3000
```

Copy your ngrok URL and add it to `fedbox.json`:

```json
{
  "domain": "abc123.ngrok.io"
}
```

Restart your server. Search for `@yourname@abc123.ngrok.io` on Mastodon.

## What You Get

- **Your own identity** — `@you@yourdomain.com`
- **Web UI editing** — Edit profile in browser
- **Nostr identity** — Link via `did:nostr`
- **Solid-compatible** — WebID at `/username#me`
- **Separated architecture** — Profile and AP server can be separate
- **Post from CLI** — `fedbox post "Hello world"`
- **Follow anyone** — `fedbox follow @user@mastodon.social`
- **View timeline** — `fedbox timeline`
- **Reply to posts** — `fedbox reply <url> "Nice!"`
- **ActivityPub compatible** — Works with Mastodon, Pleroma, Pixelfed, etc.
- **HTTP Signature verification** — Secure federation
- **Rate limiting** — Protection against abuse
- **Persistent storage** — SQLite database

## Configuration

After `fedbox init`, you'll have a `fedbox.json`:

```json
{
  "username": "alice",
  "displayName": "Alice",
  "summary": "Hello, Fediverse!",
  "port": 3000,
  "domain": null,
  "apServer": null,
  "profileUrl": null,
  "nostrPubkey": null,
  "avatar": null,
  "publicKey": "...",
  "privateKey": "..."
}
```

| Field | Description |
|-------|-------------|
| `domain` | Your public domain (for federation) |
| `apServer` | External AP server URL (for separated mode) |
| `profileUrl` | Remote HTML profile URL (extracts JSON-LD data island) |
| `nostrPubkey` | 64-char hex Nostr pubkey |
| `avatar` | Avatar filename in `public/` |

## How It Works

Fedbox uses [microfed](https://github.com/micro-fed/microfed.org) for ActivityPub primitives:

- **Profile** — Your actor/identity with JSON-LD
- **Inbox** — Receive follows, likes, boosts, posts
- **Outbox** — Your posts
- **WebFinger** — So others can find you
- **HTTP Signatures** — Secure signed requests
- **Nodeinfo** — Server discovery

Data is stored in SQLite (`data/fedbox.db`).

## Requirements

- Node.js 18+
- For federation: ngrok or a public server with HTTPS

## License

MIT

---

**Built with [microfed](https://github.com/micro-fed/microfed.org). Happy federating! 📦**
