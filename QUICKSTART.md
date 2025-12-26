# Fedbox Quickstart

Clean slate setup with ngrok federation.

## 1. Clean existing data

```bash
# Remove database only
fedbox clean

# Remove everything (database + config + keys)
fedbox clean --all
```

## 2. Initialize

```bash
fedbox init
```

Prompts for: username, display name, bio, port (default 3000).

Creates `fedbox.json` with generated keypair.

## 3. Start server

```bash
fedbox start
```

Server runs at `http://localhost:3000/{username}`

## 4. Expose with ngrok

In another terminal:

```bash
ngrok http 3000
```

Copy the https URL (e.g., `https://abc123.ngrok-free.app`)

## 5. Configure domain

Edit `fedbox.json`, add domain (without https://):

```json
{
  "domain": "abc123.ngrok-free.app",
  ...
}
```

Restart server (`Ctrl+C`, then `fedbox start`).

## 6. Test federation

From Mastodon, search for `@{username}@{domain}`

## 7. Post something

```bash
fedbox post "Hello, Fediverse!"
```

## URI Structure (Solid-compatible)

| URI | Purpose |
|-----|---------|
| `/{username}` | Profile (HTML + JSON-LD) |
| `/{username}#me` | WebID (Actor ID) |
| `/{username}/inbox` | Inbox |
| `/{username}/outbox` | Outbox |
| `/{username}/posts/{id}` | Individual post |
| `/{username}#main-key` | Public key |

## All Commands

```
fedbox init              # Setup identity
fedbox start             # Start server
fedbox status            # Show config
fedbox post "text"       # Post to followers
fedbox follow @user@dom  # Follow someone
fedbox timeline          # View feed
fedbox reply <url> "text"# Reply to post
fedbox posts             # View own posts
fedbox clean             # Remove database
fedbox clean --all       # Remove everything
```
