/**
 * Microfed Profile Component
 * Reads JSON-LD data island and renders a profile card
 *
 * Usage: <script src="profile.js"></script>
 * Requires: <script type="application/ld+json" id="profile">...</script>
 */
(function() {
  'use strict'

  function init() {
    // Find JSON-LD data island
    const script = document.querySelector('script[type="application/ld+json"]#profile') ||
                   document.querySelector('script[type="application/ld+json"]')

    if (!script) {
      console.warn('Microfed Profile: No JSON-LD data island found')
      return
    }

    let actor
    try {
      actor = JSON.parse(script.textContent)
    } catch (e) {
      console.error('Microfed Profile: Invalid JSON-LD', e)
      return
    }

    // Find or create container
    let container = document.getElementById('microfed-profile')
    if (!container) {
      container = document.createElement('div')
      container.id = 'microfed-profile'
      script.parentNode.insertBefore(container, script.nextSibling)
    }

    render(container, actor)
  }

  function render(container, actor) {
    const name = actor.name || actor.preferredUsername || 'Unknown'
    const username = actor.preferredUsername || ''
    const summary = actor.summary || ''
    const icon = actor.icon?.url || actor.icon || ''
    const followers = actor.followers || ''
    const following = actor.following || ''

    container.innerHTML = `
      <style>
        .mf-profile {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 400px;
          border: 1px solid #e1e4e8;
          border-radius: 8px;
          padding: 20px;
          background: #fff;
        }
        .mf-profile-header {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 12px;
        }
        .mf-profile-avatar {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          object-fit: cover;
          background: #e1e4e8;
        }
        .mf-profile-avatar-placeholder {
          width: 64px;
          height: 64px;
          border-radius: 50%;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 24px;
          font-weight: bold;
        }
        .mf-profile-name {
          font-size: 1.25rem;
          font-weight: 600;
          margin: 0;
          color: #24292e;
        }
        .mf-profile-username {
          font-size: 0.875rem;
          color: #586069;
          margin: 2px 0 0 0;
        }
        .mf-profile-summary {
          color: #24292e;
          line-height: 1.5;
          margin: 12px 0;
        }
        .mf-profile-stats {
          display: flex;
          gap: 16px;
          margin-top: 12px;
          padding-top: 12px;
          border-top: 1px solid #e1e4e8;
        }
        .mf-profile-stat {
          color: #586069;
          font-size: 0.875rem;
          text-decoration: none;
        }
        .mf-profile-stat:hover {
          color: #0366d6;
        }
        .mf-profile-stat strong {
          color: #24292e;
        }
      </style>
      <div class="mf-profile">
        <div class="mf-profile-header">
          ${icon
            ? `<img class="mf-profile-avatar" src="${escapeHtml(icon)}" alt="${escapeHtml(name)}">`
            : `<div class="mf-profile-avatar-placeholder">${escapeHtml(name.charAt(0).toUpperCase())}</div>`
          }
          <div>
            <h2 class="mf-profile-name">${escapeHtml(name)}</h2>
            ${username ? `<p class="mf-profile-username">@${escapeHtml(username)}</p>` : ''}
          </div>
        </div>
        ${summary ? `<div class="mf-profile-summary">${summary}</div>` : ''}
        <div class="mf-profile-stats">
          ${followers ? `<a class="mf-profile-stat" href="${escapeHtml(followers)}"><strong>Followers</strong></a>` : ''}
          ${following ? `<a class="mf-profile-stat" href="${escapeHtml(following)}"><strong>Following</strong></a>` : ''}
        </div>
      </div>
    `
  }

  function escapeHtml(str) {
    if (!str) return ''
    const div = document.createElement('div')
    div.textContent = str
    return div.innerHTML
  }

  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
