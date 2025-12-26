/**
 * Fedbox Profile Server
 * Minimal server that just serves the profile
 * Great for testing, Solid integration, or static-like deployment
 */

import { createServer } from 'http'
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'fs'
import { join, extname } from 'path'

let config = null

/**
 * Load configuration
 */
function loadConfig() {
  if (!existsSync('fedbox.json')) {
    throw new Error('Not initialized. Run: fedbox init')
  }
  config = JSON.parse(readFileSync('fedbox.json', 'utf8'))
  return config
}

/**
 * Get base URL
 */
function getBaseUrl(port) {
  if (config.domain) {
    return `https://${config.domain}`
  }
  return `http://localhost:${port}`
}

/**
 * Build actor object
 */
function buildActor(baseUrl) {
  const profileUrl = `${baseUrl}/${config.username}`
  const actorId = `${profileUrl}#me`

  const actor = {
    '@context': [
      'https://www.w3.org/ns/activitystreams',
      'https://w3id.org/security/v1'
    ],
    type: 'Person',
    id: actorId,
    url: profileUrl,
    preferredUsername: config.username,
    name: config.displayName,
    summary: config.summary ? `<p>${config.summary}</p>` : '',
    inbox: `${profileUrl}/inbox`,
    outbox: `${profileUrl}/outbox`,
    followers: `${profileUrl}/followers`,
    following: `${profileUrl}/following`,
    endpoints: {
      sharedInbox: `${baseUrl}/inbox`
    },
    publicKey: {
      id: `${profileUrl}#main-key`,
      owner: actorId,
      publicKeyPem: config.publicKey
    }
  }

  if (config.avatar) {
    actor.icon = {
      type: 'Image',
      mediaType: config.avatar.endsWith('.png') ? 'image/png' :
                 config.avatar.endsWith('.gif') ? 'image/gif' : 'image/jpeg',
      url: `${baseUrl}/public/${config.avatar}`
    }
  }

  // Add alsoKnownAs for identity linking (Nostr, etc.)
  const alsoKnownAs = []
  if (config.nostrPubkey) {
    alsoKnownAs.push(`did:nostr:${config.nostrPubkey}`)
  }
  if (alsoKnownAs.length > 0) {
    actor.alsoKnownAs = alsoKnownAs
  }

  return actor
}

/**
 * Render profile HTML
 */
function renderProfile(actor, baseUrl) {
  const avatarUrl = config.avatar ? `/public/${config.avatar}` : ''

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${config.displayName} (@${config.username})</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="alternate" type="application/activity+json" href="${actor.url}">
  <script type="application/ld+json" id="profile">
${JSON.stringify(actor, null, 2)}
  </script>
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
      position: relative;
    }
    .edit-btn {
      position: absolute;
      top: 1rem;
      right: 1rem;
      background: #667eea;
      color: white;
      border: none;
      padding: 0.5rem 1rem;
      border-radius: 8px;
      cursor: pointer;
      font-size: 0.9rem;
    }
    .edit-btn:hover { background: #5a6fd6; }
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
      overflow: hidden;
      cursor: pointer;
      position: relative;
    }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .avatar-overlay {
      display: none;
      position: absolute;
      inset: 0;
      background: rgba(0,0,0,0.5);
      align-items: center;
      justify-content: center;
      font-size: 1rem;
    }
    .editing .avatar-overlay { display: flex; }
    .avatar-input { display: none; }
    h1 { margin: 0 0 0.5rem; }
    .handle { color: #888; margin-bottom: 1rem; }
    .bio { color: #aaa; margin-bottom: 1.5rem; }
    .badge {
      display: inline-block;
      background: #667eea;
      color: white;
      padding: 0.5rem 1rem;
      border-radius: 20px;
      margin-top: 1.5rem;
      font-size: 0.9rem;
    }
    .edit-input {
      background: #0f172a;
      border: 1px solid #667eea;
      color: #eee;
      padding: 0.5rem;
      border-radius: 8px;
      font-size: inherit;
      text-align: center;
      width: 100%;
      max-width: 300px;
    }
    .edit-textarea {
      background: #0f172a;
      border: 1px solid #667eea;
      color: #aaa;
      padding: 0.5rem;
      border-radius: 8px;
      font-size: 1rem;
      text-align: center;
      width: 100%;
      max-width: 400px;
      resize: vertical;
      min-height: 60px;
    }
    .edit-actions {
      display: none;
      gap: 0.5rem;
      justify-content: center;
      margin-top: 1rem;
    }
    .editing .edit-actions { display: flex; }
    .save-btn { background: #22c55e; color: white; border: none; padding: 0.5rem 1.5rem; border-radius: 8px; cursor: pointer; }
    .cancel-btn { background: #64748b; color: white; border: none; padding: 0.5rem 1.5rem; border-radius: 8px; cursor: pointer; }
    .view-mode { display: block; }
    .edit-mode { display: none; }
    .editing .view-mode { display: none; }
    .editing .edit-mode { display: block; }
    .editing .edit-btn { display: none; }
  </style>
</head>
<body>
  <div class="card" id="profile-card">
    <button class="edit-btn" onclick="toggleEdit()">Edit</button>

    <div class="avatar" onclick="document.getElementById('avatar-input').click()">
      ${avatarUrl ? `<img src="${avatarUrl}" alt="avatar">` : '📦'}
      <div class="avatar-overlay">Change</div>
    </div>
    <input type="file" id="avatar-input" class="avatar-input" accept="image/*" onchange="previewAvatar(this)">

    <div class="view-mode"><h1>${config.displayName}</h1></div>
    <div class="edit-mode">
      <input type="text" class="edit-input" id="edit-name" value="${config.displayName}" placeholder="Display Name">
    </div>

    <p class="handle">@${config.username}</p>

    <div class="view-mode">
      ${config.summary ? `<p class="bio">${config.summary}</p>` : '<p class="bio" style="opacity:0.5">No bio yet</p>'}
    </div>
    <div class="edit-mode">
      <textarea class="edit-textarea" id="edit-summary" placeholder="Write a short bio...">${config.summary || ''}</textarea>
    </div>

    ${config.nostrPubkey ? `<p class="view-mode" style="margin-bottom:1rem"><a href="nostr:${config.nostrPubkey}" style="color:#667eea;font-size:0.85rem">did:nostr:${config.nostrPubkey.slice(0,8)}...</a></p>` : ''}
    <div class="edit-mode" style="margin-bottom:1rem">
      <input type="text" class="edit-input" id="edit-nostr" value="${config.nostrPubkey || ''}" placeholder="Nostr pubkey (64-char hex)" style="font-size:0.85rem;max-width:400px">
    </div>

    <div class="edit-actions">
      <button class="save-btn" onclick="saveProfile()">Save</button>
      <button class="cancel-btn" onclick="toggleEdit()">Cancel</button>
    </div>

    <div class="badge">🪪 Profile</div>
  </div>

  <script>
    let avatarFile = null;
    function toggleEdit() {
      document.getElementById('profile-card').classList.toggle('editing');
      avatarFile = null;
    }
    function previewAvatar(input) {
      if (input.files && input.files[0]) {
        avatarFile = input.files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
          const avatar = document.querySelector('.avatar');
          avatar.innerHTML = '<img src="' + e.target.result + '" alt="avatar"><div class="avatar-overlay">Change</div>';
        };
        reader.readAsDataURL(input.files[0]);
      }
    }
    async function saveProfile() {
      const formData = new FormData();
      formData.append('displayName', document.getElementById('edit-name').value);
      formData.append('summary', document.getElementById('edit-summary').value);
      formData.append('nostrPubkey', document.getElementById('edit-nostr').value);
      if (avatarFile) formData.append('avatar', avatarFile);
      try {
        const res = await fetch('/edit', { method: 'POST', body: formData });
        if (res.ok) location.reload();
        else alert('Failed to save');
      } catch (err) { alert('Error: ' + err.message); }
    }
  </script>
</body>
</html>`
}

/**
 * Parse multipart form data
 */
function parseMultipart(body, boundary) {
  const parts = {}
  const boundaryBuffer = Buffer.from('--' + boundary)
  const doubleCrlf = Buffer.from('\r\n\r\n')

  let start = 0
  while (true) {
    const boundaryPos = body.indexOf(boundaryBuffer, start)
    if (boundaryPos === -1) break
    const afterBoundary = boundaryPos + boundaryBuffer.length
    if (body.slice(afterBoundary, afterBoundary + 2).toString() === '--') break
    const headersEnd = body.indexOf(doubleCrlf, afterBoundary)
    if (headersEnd === -1) break
    const headers = body.slice(afterBoundary + 2, headersEnd).toString()
    const nextBoundary = body.indexOf(boundaryBuffer, headersEnd)
    const content = body.slice(headersEnd + 4, nextBoundary - 2)
    const nameMatch = headers.match(/name="([^"]+)"/)
    const filenameMatch = headers.match(/filename="([^"]+)"/)
    const contentTypeMatch = headers.match(/Content-Type:\s*([^\r\n]+)/)
    if (nameMatch) {
      const name = nameMatch[1]
      if (filenameMatch) {
        parts[name] = {
          filename: filenameMatch[1],
          contentType: contentTypeMatch ? contentTypeMatch[1] : 'application/octet-stream',
          data: content
        }
      } else {
        parts[name] = content.toString()
      }
    }
    start = nextBoundary
  }
  return parts
}

/**
 * Handle profile edit
 */
async function handleEdit(req, res) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = Buffer.concat(chunks)

  const contentType = req.headers['content-type'] || ''
  const boundary = contentType.split('boundary=')[1]
  if (!boundary) {
    res.writeHead(400)
    return res.end('Bad request')
  }

  const parts = parseMultipart(body, boundary)
  let updated = false

  if (parts.displayName !== undefined) {
    config.displayName = parts.displayName
    updated = true
  }
  if (parts.summary !== undefined) {
    config.summary = parts.summary
    updated = true
  }
  if (parts.nostrPubkey !== undefined) {
    config.nostrPubkey = parts.nostrPubkey || undefined
    updated = true
  }
  if (parts.avatar && parts.avatar.data && parts.avatar.data.length > 0) {
    if (!existsSync('public')) mkdirSync('public', { recursive: true })
    const ext = parts.avatar.contentType?.includes('png') ? 'png' :
                parts.avatar.contentType?.includes('gif') ? 'gif' : 'jpg'
    const filename = `avatar.${ext}`
    writeFileSync(join('public', filename), parts.avatar.data)
    config.avatar = filename
    updated = true
    console.log(`📷 Avatar saved: public/${filename}`)
  }

  if (updated) {
    writeFileSync('fedbox.json', JSON.stringify(config, null, 2))
    console.log('✅ Profile updated')
  }

  res.writeHead(200)
  res.end('OK')
}

/**
 * Start the profile server
 */
export async function startProfileServer(port = 3000) {
  loadConfig()
  const baseUrl = getBaseUrl(port)
  const actor = buildActor(baseUrl)

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, baseUrl)
    const path = url.pathname
    const accept = req.headers.accept || ''
    const isAP = accept.includes('activity+json') || accept.includes('ld+json')

    // CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      return res.end()
    }

    console.log(`${req.method} ${path}`)

    // Profile edit
    if (path === '/edit' && req.method === 'POST') {
      return handleEdit(req, res)
    }

    // Static files
    if (path.startsWith('/public/')) {
      const filePath = join(process.cwd(), path)
      if (existsSync(filePath)) {
        const ext = extname(filePath)
        const mimeTypes = {
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.png': 'image/png',
          '.jpg': 'image/jpeg',
          '.gif': 'image/gif',
          '.svg': 'image/svg+xml'
        }
        res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream')
        return res.end(readFileSync(filePath))
      }
    }

    // Profile (root or /username)
    if (path === '/' || path === `/${config.username}`) {
      if (isAP) {
        res.setHeader('Content-Type', 'application/activity+json')
        return res.end(JSON.stringify(actor, null, 2))
      }
      res.setHeader('Content-Type', 'text/html')
      return res.end(renderProfile(actor, baseUrl))
    }

    res.writeHead(404)
    res.end('Not found')
  })

  server.listen(port, () => {
    console.log(`
🪪 Profile server running!

   Profile: http://localhost:${port}/
   WebID:   http://localhost:${port}/${config.username}#me
   JSON-LD: curl -H "Accept: application/activity+json" http://localhost:${port}/

   Press Ctrl+C to stop
`)
  })
}

export default { startProfileServer }
