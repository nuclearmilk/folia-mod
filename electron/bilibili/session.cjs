// electron/bilibili/session.cjs
// Manages Bilibili credentials and persistent login cookies.

const SESSION_KEY = 'BILIBILI_SESSION_V1';

function createBilibiliSessionRepository({ store, safeStorage, warn = console.warn }) {
  let loaded = false;
  let current = null;
  let revision = 0;
  let unread = false;
  let toldUnsealed = false;

  const canEncrypt = () => safeStorage?.isEncryptionAvailable()
    && safeStorage.getSelectedStorageBackend?.() !== 'basic_text';

  return {
    get revision() { return revision; },
    unreadable() { return unread; },
    get() {
      if (loaded) return current;
      loaded = true;
      try {
        const sealed = store.get(SESSION_KEY);
        if (typeof sealed !== 'string') return null;
        if (!canEncrypt()) {
          unread = true;
          warn('[BiliSession] Stored session cannot be read: OS encryption is unavailable');
          return null;
        }
        const decrypted = safeStorage.decryptString(Buffer.from(sealed, 'base64'));
        const value = JSON.parse(decrypted);
        if (value && typeof value === 'object' && value.cookies) {
          current = value;
        }
      } catch (err) {
        warn('[BiliSession] Encrypted session could not be restored', err);
      }
      return current;
    },
    set(value) {
      loaded = true;
      current = value ? {
        version: 1,
        cookies: value.cookies || {},
        cookieString: value.cookieString || '',
        mid: value.mid || null,
        user: value.user || null,
        updatedAt: Date.now()
      } : null;
      revision++;

      if (!value) {
        store.delete(SESSION_KEY);
        return;
      }

      if (!canEncrypt()) {
        store.delete(SESSION_KEY);
        if (!toldUnsealed) warn('[BiliSession] Login available for this run only; OS encryption is unavailable');
        toldUnsealed = true;
        return;
      }

      try {
        const payload = JSON.stringify(current);
        const encrypted = safeStorage.encryptString(payload).toString('base64');
        store.set(SESSION_KEY, encrypted);
      } catch (err) {
        warn('[BiliSession] Failed to encrypt session', err);
      }
    },
    clear() {
      this.set(null);
    },
    getCookieString() {
      const session = this.get();
      return session?.cookieString || '';
    },
    getMid() {
      const session = this.get();
      return session?.mid || null;
    }
  };
}

module.exports = { createBilibiliSessionRepository };
