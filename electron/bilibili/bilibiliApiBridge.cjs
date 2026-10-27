// electron/bilibili/bilibiliApiBridge.cjs
// Bridge connecting Electron IPC to Bilibili API service.

const { createBilibiliSessionRepository } = require('./session.cjs');
const { createBilibiliApi } = require('./bilibiliApi.cjs');

const BILIBILI_OPERATIONS = [
  'login_qr_key',
  'login_qr_create',
  'login_qr_check',
  'login_status',
  'logout',
  'user_playlists',
  'playlist_detail',
  'video_detail',
  'audio',
  'search'
];

function createBilibiliApiBridge({
  store,
  safeStorage,
  onAudioSource = () => {},
  now = Date.now,
  warn = console.warn
}) {
  const sessions = createBilibiliSessionRepository({ store, safeStorage, warn });
  const api = createBilibiliApi({ sessions, now, warn });

  return {
    async request(operation, params = {}) {
      try {
        if (!BILIBILI_OPERATIONS.includes(operation)) {
          return { ok: false, error: { code: 'unsupported', message: `Unsupported Bilibili operation: ${operation}` } };
        }

        if (operation === 'logout') {
          sessions.clear();
        }

        if (operation === 'login_status' && sessions.unreadable()) {
          return { ok: false, error: { code: 'unavailable', message: 'Stored Bilibili credentials cannot be read' } };
        }

        const result = await api.request(operation, params);

        if (result.ok && operation === 'audio' && result.data?.url) {
          onAudioSource(result.data.url);
        }

        return result;
      } catch (err) {
        warn('[BiliBridge] Operation failed', operation, err);
        return { ok: false, error: { code: 'invalid-response', message: err?.message || 'Bilibili operation failed' } };
      }
    }
  };
}

module.exports = { createBilibiliApiBridge };
