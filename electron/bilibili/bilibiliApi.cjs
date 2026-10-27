// electron/bilibili/bilibiliApi.cjs
// Native Node.js Bilibili API Client with WBI signature and session management.

const crypto = require('node:crypto');

const BILI_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const BILI_REFERER = 'https://www.bilibili.com/';

const MIXIN_KEY_ENC_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49,
  33, 9, 42, 19, 29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61,
  26, 17, 0, 1, 60, 51, 30, 4, 22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36,
  20, 34, 44, 52
];

function getMixinKey(orig) {
  let str = '';
  for (let i = 0; i < 32; i++) {
    str += orig[MIXIN_KEY_ENC_TAB[i]];
  }
  return str;
}

function md5(str) {
  return crypto.createHash('md5').update(str).digest('hex');
}

function parseCookiesFromHeaders(headers) {
  const cookies = {};
  const setCookies = typeof headers.getSetCookie === 'function'
    ? headers.getSetCookie()
    : [headers.get('set-cookie')].filter(Boolean);

  for (const header of setCookies) {
    const parts = header.split(';');
    for (const part of parts) {
      const [key, val] = part.trim().split('=');
      if (key && val && !['path', 'domain', 'expires', 'httponly', 'secure', 'samesite'].includes(key.toLowerCase())) {
        cookies[key] = val;
      }
    }
  }
  return cookies;
}

function serializeCookies(cookieObj) {
  return Object.entries(cookieObj).map(([k, v]) => `${k}=${v}`).join('; ');
}

function createBilibiliApi({ sessions, now = Date.now, warn = console.warn }) {
  let cachedMixinKey = null;
  let mixinKeyExpiresAt = 0;

  async function biliFetch(url, options = {}) {
    const cookieStr = sessions.getCookieString();
    const headers = {
      'User-Agent': BILI_USER_AGENT,
      'Referer': BILI_REFERER,
      ...(cookieStr ? { 'Cookie': cookieStr } : {}),
      ...(options.headers || {}),
    };
    const resp = await fetch(url, {
      ...options,
      headers,
    });
    return resp;
  }

  async function getMixinKeyCached() {
    if (cachedMixinKey && now() < mixinKeyExpiresAt) {
      return cachedMixinKey;
    }
    try {
      const resp = await biliFetch('https://api.bilibili.com/x/web-interface/nav');
      const data = await resp.json();
      const imgUrl = data.data?.wbi_img?.img_url;
      const subUrl = data.data?.wbi_img?.sub_url;
      if (imgUrl && subUrl) {
        const imgKey = imgUrl.slice(imgUrl.lastIndexOf('/') + 1, imgUrl.lastIndexOf('.'));
        const subKey = subUrl.slice(subUrl.lastIndexOf('/') + 1, subUrl.lastIndexOf('.'));
        cachedMixinKey = getMixinKey(imgKey + subKey);
        mixinKeyExpiresAt = now() + 24 * 60 * 60 * 1000;
        return cachedMixinKey;
      }
    } catch (err) {
      warn('[BiliApi] Failed to fetch WBI keys', err);
    }
    // Fallback default key if request fails
    return cachedMixinKey || 'ea1db124c3d70e8b288b4394f1a196ad';
  }

  async function signWbi(baseUrl, paramsIn = {}) {
    const mixinKey = await getMixinKeyCached();
    const params = { ...paramsIn };
    params.wts = String(Math.floor(now() / 1000));

    const keys = Object.keys(params).sort();
    const query = keys.map(k => {
      const v = String(params[k]).replace(/[!'()*]/g, '');
      return `${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
    }).join('&');

    const w_rid = md5(query + mixinKey);
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}${query}&w_rid=${w_rid}`;
  }

  return {
    async request(operation, params = {}) {
      switch (operation) {
        case 'login_qr_key': {
          const resp = await biliFetch('https://passport.bilibili.com/x/passport-login/web/qrcode/generate', {
            headers: { 'Referer': 'https://passport.bilibili.com/login' }
          });
          const json = await resp.json();
          if (json.code !== 0) {
            return { ok: false, error: { code: 'network', message: json.message || 'Failed to generate QR' } };
          }
          return {
            ok: true,
            data: {
              key: json.data.qrcode_key,
              url: json.data.url
            }
          };
        }

        case 'login_qr_create': {
          const key = params.key;
          const targetUrl = params.url || `https://account.bilibili.com/h5/account-h5/auth/scan-web?navhide=1&callback=close&qrcode_key=${encodeURIComponent(key)}&from=`;
          try {
            const apiPkg = ['bo', 'dian', '-music-api'].join('');
            const QRCode = require(require.resolve('qrcode', { paths: [require.resolve(apiPkg)] }));
            const dataUrl = await QRCode.toDataURL(targetUrl, { width: 240, margin: 2 });
            return { ok: true, data: { imageUrl: dataUrl } };
          } catch (qrErr) {
            const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(targetUrl)}`;
            return { ok: true, data: { imageUrl: qrImageUrl } };
          }
        }

        case 'login_qr_check': {
          const key = params.key;
          const url = `https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=${encodeURIComponent(key)}`;
          const resp = await biliFetch(url, {
            headers: { 'Referer': 'https://passport.bilibili.com/login' }
          });
          const json = await resp.json();
          const pollCode = json.data?.code;

          if (pollCode === 86101) {
            return { ok: true, data: { state: 'waiting' } };
          }
          if (pollCode === 86090) {
            return { ok: true, data: { state: 'scanned' } };
          }
          if (pollCode === 86038) {
            return { ok: true, data: { state: 'expired' } };
          }
          if (pollCode === 0) {
            // Success! Extract Set-Cookie
            const cookies = parseCookiesFromHeaders(resp.headers);
            const cookieString = serializeCookies(cookies);
            const mid = cookies.DedeUserID || null;

            // Fetch user info with new cookies
            sessions.set({ cookies, cookieString, mid });
            const navResp = await biliFetch('https://api.bilibili.com/x/web-interface/nav', {
              headers: { 'Cookie': cookieString }
            });
            const navJson = await navResp.json();
            const userData = navJson.data;
            const user = userData ? {
              id: String(userData.mid),
              nickname: userData.uname,
              avatarUrl: userData.face,
              vipType: userData.vipType
            } : null;

            sessions.set({ cookies, cookieString, mid, user });
            return { ok: true, data: { state: 'confirmed', user } };
          }

          return { ok: true, data: { state: 'error', message: json.data?.message || 'Login check error' } };
        }

        case 'login_status': {
          const cookieStr = sessions.getCookieString();
          if (!cookieStr) {
            return { ok: true, data: null };
          }
          try {
            const resp = await biliFetch('https://api.bilibili.com/x/web-interface/nav');
            const json = await resp.json();
            if (json.code === 0 && json.data?.isLogin) {
              const u = json.data;
              const user = {
                id: String(u.mid),
                nickname: u.uname,
                avatarUrl: u.face,
                vipType: u.vipType
              };
              return { ok: true, data: user };
            }
          } catch (err) {
            warn('[BiliApi] Check login status failed', err);
          }
          return { ok: true, data: null };
        }

        case 'logout': {
          sessions.clear();
          return { ok: true, data: null };
        }

        case 'user_playlists': {
          const mid = params.userId || sessions.getMid();
          if (!mid) {
            return { ok: true, data: { list: [], hasMore: false, total: 0 } };
          }
          // Use created/list to obtain covers (automatically set to latest video in the folder)
          const url = `https://api.bilibili.com/x/v3/fav/folder/created/list?up_mid=${encodeURIComponent(mid)}&pn=1&ps=50`;
          let resp = await biliFetch(url);
          let json = await resp.json();
          if (json.code !== 0) {
            // Fallback to list-all if created/list fails
            const fallbackUrl = `https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=${encodeURIComponent(mid)}`;
            resp = await biliFetch(fallbackUrl);
            json = await resp.json();
          }
          if (json.code !== 0) {
            return { ok: false, error: { code: 'network', message: json.message || 'Failed to get playlists' } };
          }
          const list = json.data?.list || [];
          return {
            ok: true,
            data: {
              list,
              total: json.data?.count || list.length,
              hasMore: Boolean(json.data?.has_more)
            }
          };
        }

        case 'playlist_detail': {
          const mediaId = params.id;
          const page = Number(params.page) || 1;
          const pageSize = Math.min(Math.max(Number(params.pageSize) || 20, 1), 20);
          const url = `https://api.bilibili.com/x/v3/fav/resource/list?media_id=${encodeURIComponent(mediaId)}&pn=${page}&ps=${pageSize}&order=mtime`;
          const resp = await biliFetch(url);
          const json = await resp.json();
          if (json.code !== 0) {
            return { ok: false, error: { code: 'network', message: json.message || 'Failed to get playlist detail' } };
          }
          const data = json.data || {};
          return {
            ok: true,
            data: {
              info: data.info || {},
              medias: data.medias || [],
              hasMore: Boolean(data.has_more),
              total: data.info?.media_count || 0
            }
          };
        }

        case 'video_detail': {
          const bvid = params.bvid;
          const signedUrl = await signWbi('https://api.bilibili.com/x/web-interface/wbi/view', { bvid });
          const resp = await biliFetch(signedUrl);
          const json = await resp.json();
          if (json.code !== 0) {
            return { ok: false, error: { code: 'not-playable', message: json.message || 'Video not found' } };
          }
          return { ok: true, data: json.data };
        }

        case 'audio': {
          const { bvid, cid, quality = 'high' } = params;
          if (!bvid || !cid) {
            return { ok: false, error: { code: 'invalid-response', message: 'Missing bvid or cid' } };
          }
          // Request DASH audio with 4048 (support Hi-Res, Dolby, DASH)
          const signedUrl = await signWbi('https://api.bilibili.com/x/player/wbi/playurl', {
            bvid,
            cid: String(cid),
            qn: '127',
            fnval: '4048',
            fourk: '1'
          });
          const resp = await biliFetch(signedUrl);
          const json = await resp.json();
          if (json.code !== 0) {
            return { ok: false, error: { code: 'not-playable', message: json.message || 'Failed to fetch audio' } };
          }

          const dash = json.data?.dash;
          const audios = dash?.audio || [];
          const flac = dash?.flac?.audio;
          const dolby = dash?.dolby?.audio?.[0];

          let chosen = null;
          let resolvedQuality = 'standard';

          // Select stream based on requested quality
          if ((quality === 'hires' || quality === 'lossless') && flac?.baseUrl) {
            chosen = flac;
            resolvedQuality = 'lossless';
          } else if (quality === 'ultra' && dolby?.baseUrl) {
            chosen = dolby;
            resolvedQuality = 'ultra';
          }

          if (!chosen && audios.length > 0) {
            // audios sorted by id/bandwidth
            // id 30280 (192k) -> high
            // id 30232 (132k) -> standard
            // id 30216 (64k)  -> low
            if (quality === 'high' || quality === 'lossless' || quality === 'hires') {
              chosen = audios.find(a => a.id === 30280) || audios[0];
              resolvedQuality = chosen.id === 30280 ? 'high' : 'standard';
            } else {
              chosen = audios.find(a => a.id === 30232) || audios[audios.length - 1];
              resolvedQuality = 'standard';
            }
          }

          if (!chosen && json.data?.durl?.[0]?.url) {
            // Fallback to progressive mp4 stream
            chosen = { baseUrl: json.data.durl[0].url };
            resolvedQuality = 'standard';
          }

          if (!chosen || !chosen.baseUrl) {
            return { ok: false, error: { code: 'not-playable', message: 'No available audio stream found' } };
          }

          return {
            ok: true,
            data: {
              url: chosen.baseUrl,
              fetchedAt: now(),
              expiresAt: now() + 2 * 60 * 60 * 1000,
              quality: resolvedQuality,
            }
          };
        }

        case 'search': {
          const { query, page = 1 } = params;
          const signedUrl = await signWbi('https://api.bilibili.com/x/web-interface/wbi/search/type', {
            search_type: 'video',
            keyword: query,
            page: String(page)
          });
          const resp = await biliFetch(signedUrl);
          const json = await resp.json();
          if (json.code !== 0) {
            return { ok: false, error: { code: 'network', message: json.message || 'Search failed' } };
          }
          const result = json.data?.result || [];
          return {
            ok: true,
            data: {
              items: result,
              total: json.data?.numResults || result.length,
              numPages: json.data?.numPages || 1
            }
          };
        }

        default:
          return { ok: false, error: { code: 'unsupported', message: `Unknown operation: ${operation}` } };
      }
    }
  };
}

module.exports = { createBilibiliApi };
