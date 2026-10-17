/**
 * Fedbox Identity
 * Who this server speaks for, and which key it signs with.
 *
 * With `profileUrl` set, the actor id and its publicKey live on a remote
 * homepage. Fedbox holds the private key, so the homepage must publish the
 * matching public key; remote servers fetch the signature's keyId to verify,
 * so it has to be the key id the homepage actually serves.
 */

function normalizePem(pem) {
  return typeof pem === 'string' ? pem.replace(/\s+/g, '') : null
}

function sameOrigin(a, b) {
  try {
    return new URL(a).origin === new URL(b).origin
  } catch {
    return false
  }
}

/**
 * Fetch remote profile and extract JSON-LD data island
 * @param {string} url - Profile URL to fetch
 * @returns {Promise<Object|null>} Extracted actor or null
 */
export async function fetchProfileDataIsland(url) {
  try {
    console.log(`📡 Fetching profile from ${url}...`)
    const response = await fetch(url, {
      headers: { 'Accept': 'text/html' }
    })
    if (!response.ok) {
      console.log(`   ⚠️ Failed to fetch: ${response.status}`)
      return null
    }

    const html = await response.text()

    // Extract JSON-LD data island
    const match = html.match(/<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i)
    if (!match) {
      console.log('   ⚠️ No JSON-LD data island found')
      return null
    }

    const actor = JSON.parse(match[1])
    console.log(`   ✅ Extracted actor: ${actor.id || actor['@id']}`)
    return actor
  } catch (err) {
    console.log(`   ❌ Error fetching profile: ${err.message}`)
    return null
  }
}

/**
 * Merge a remote profile with this server's AP endpoints.
 * Returns { actor } or { error } when the profile does not publish a key
 * this server can sign for.
 *
 * @param {Object} remoteActor - Actor from the profile's data island
 * @param {Object} options
 * @param {string} options.baseUrl - This server's base URL
 * @param {string} options.username - Local username
 * @param {string} options.publicKey - This server's public key PEM
 */
export function mergeProfileActor(remoteActor, { baseUrl, username, publicKey }) {
  const id = remoteActor?.id || remoteActor?.['@id']
  if (!id) return { error: 'Profile has no actor id' }

  const keyId = `${id.replace(/#.*$/, '')}#main-key`
  const keys = [].concat(remoteActor.publicKey || [])
  const key = keys.find(k => normalizePem(k?.publicKeyPem) === normalizePem(publicKey))
  if (!key?.id) {
    return {
      error: `Profile ${id} does not publish this server's public key. ` +
        `Add "publicKey": { "id": "${keyId}", "owner": "${id}", "publicKeyPem": <publicKey from fedbox.json> } to its data island`
    }
  }
  if (!sameOrigin(key.id, id)) {
    return { error: `Key ${key.id} is not on the same origin as actor ${id}` }
  }

  const profileUrl = `${baseUrl}/${username}`
  return {
    actor: {
      ...remoteActor,
      id,
      // Override AP endpoints to point to this server
      inbox: `${profileUrl}/inbox`,
      outbox: `${profileUrl}/outbox`,
      followers: `${profileUrl}/followers`,
      following: `${profileUrl}/following`,
      endpoints: {
        sharedInbox: `${baseUrl}/inbox`
      },
      publicKey: { ...key, owner: key.owner || id }
    }
  }
}

/**
 * Resolve the remote profile identity, or null to fall back to local config
 */
export async function resolveProfileActor(config, baseUrl) {
  if (!config.profileUrl) return null

  const remoteActor = await fetchProfileDataIsland(config.profileUrl)
  if (!remoteActor) return null

  const { actor, error } = mergeProfileActor(remoteActor, {
    baseUrl,
    username: config.username,
    publicKey: config.publicKey
  })
  if (error) {
    console.log(`   ⚠️ ${error}`)
    return null
  }
  return actor
}

export default { fetchProfileDataIsland, mergeProfileActor, resolveProfileActor }
