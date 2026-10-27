// electron/bilibili/mediaCors.cjs
// Media policy and CORS/Referer bypass for Bilibili audio and cover images.

function createBilibiliMediaPolicy({ now = Date.now } = {}) {
  const issuedUrls = new Map();
  const ttl = 4 * 60 * 60 * 1000; // 4 hours

  const normalize = (value) => {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
      url.hash = '';
      return url;
    } catch {
      return null;
    }
  };

  const register = (value) => {
    const url = normalize(value);
    if (!url) return;
    issuedUrls.delete(url.href);
    issuedUrls.set(url.href, now() + ttl);
    while (issuedUrls.size > 2048) {
      issuedUrls.delete(issuedUrls.keys().next().value);
    }
  };

  const allows = (details) => {
    if (!['media', 'xhr', 'image'].includes(details.resourceType) || !['GET', 'HEAD', 'OPTIONS'].includes(details.method)) {
      return false;
    }
    const url = normalize(details.url);
    if (!url) return false;

    // Check directly registered audio stream URL
    const expiry = issuedUrls.get(url.href);
    if (expiry > now()) return true;
    if (expiry !== undefined) issuedUrls.delete(url.href);

    const hostname = url.hostname;
    // Bilibili audio CDN domains
    const isBiliVideoHost = hostname.endsWith('.bilivideo.com') ||
      hostname.endsWith('.bilivideo.cn') ||
      hostname.endsWith('.mcdn.bilivideo.cn') ||
      hostname === 'bilivideo.com' ||
      hostname === 'bilivideo.cn';

    if (isBiliVideoHost) {
      return true;
    }

    // Bilibili cover CDN
    const isImageHost = hostname.endsWith('.hdslb.com') || hostname === 'hdslb.com';
    if (isImageHost && (details.resourceType === 'image' || details.resourceType === 'xhr')) {
      return true;
    }

    return false;
  };

  const shouldInjectReferer = (urlStr) => {
    const url = normalize(urlStr);
    if (!url) return false;
    const hostname = url.hostname;
    return hostname.endsWith('.bilivideo.com') ||
      hostname.endsWith('.bilivideo.cn') ||
      hostname.endsWith('.mcdn.bilivideo.cn') ||
      hostname.endsWith('.hdslb.com') ||
      hostname.endsWith('.bilibili.com');
  };

  return {
    register,
    allows,
    shouldInjectReferer,
    followRedirect(details) {
      if (allows(details)) register(details.redirectURL);
    },
  };
}

module.exports = { createBilibiliMediaPolicy };
