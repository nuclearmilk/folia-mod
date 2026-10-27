// src/services/onlineMusic/bilibili/bilibiliNormalize.ts
// Normalizes Bilibili API data into Folia models.

import type { Artist, UnifiedSong } from '../../../types';
import type { ProviderCollection, ProviderPage, ProviderUser } from '../../../types/onlineMusic';

export const cleanText = (value: unknown): string => {
    if (value == null) return '';
    return String(value).replace(/<[^>]+>/g, '').trim();
};

export const ensureHttps = (url: unknown): string => {
    if (!url) return '';
    let str = String(url).trim();
    if (str.startsWith('//')) {
        str = 'https:' + str;
    } else if (str.startsWith('http://')) {
        str = 'https://' + str.slice(7);
    }
    if (typeof window !== 'undefined' && !(window as any).electron?.bilibiliRequest && (str.includes('.hdslb.com') || str.includes('.bilivideo.'))) {
        return `/api/bilibili-media?url=${encodeURIComponent(str)}`;
    }
    return str;
};

export const normalizeBilibiliSong = (raw: any): UnifiedSong => {
    if (raw?.sourceRef?.kind === 'online' && raw.sourceRef.providerId === 'bilibili') {
        return raw as UnifiedSong;
    }

    const bvid = String(raw.bvid || raw.bv_id || (typeof raw.id === 'string' && raw.id.startsWith('BV') ? raw.id : ''));
    const cid = raw.cid || raw.ugc?.first_cid ? String(raw.cid || raw.ugc?.first_cid) : '';
    const title = cleanText(raw.title || raw.name);
    const coverUrl = ensureHttps(raw.pic || raw.cover || raw.album?.coverUrl);
    const durationSec = Number(raw.duration || (typeof raw.durationMs === 'number' ? raw.durationMs / 1000 : 0)) || 0;

    let authorName = 'Bilibili';
    let authorMid = '';
    if (raw.owner) {
        authorName = cleanText(raw.owner.name);
        authorMid = String(raw.owner.mid || '');
    } else if (raw.upper) {
        authorName = cleanText(raw.upper.name);
        authorMid = String(raw.upper.mid || '');
    } else if (raw.author) {
        authorName = cleanText(raw.author);
        authorMid = String(raw.mid || '');
    } else if (Array.isArray(raw.artists) && raw.artists.length > 0) {
        authorName = cleanText(raw.artists[0].name);
        authorMid = String(raw.artists[0].id || '');
    }

    const artists: Artist[] = [{
        id: authorMid || 'bilibili_up',
        name: authorName,
        catalogRef: authorMid ? { providerId: 'bilibili', kind: 'artist', id: authorMid } : undefined,
    }];

    const mediaId = cid ? `${bvid}_${cid}` : bvid;
    const pageCount = Number(raw.page) || 1;
    const albumName = pageCount > 1 ? `${title} (${pageCount}P 选集)` : title;

    return {
        id: mediaId,
        name: title,
        artists,
        album: {
            id: bvid,
            name: albumName,
            coverUrl,
            catalogRef: { providerId: 'bilibili', kind: 'album', id: bvid },
        },
        durationMs: Math.max(0, durationSec * 1000),
        sourceRef: {
            kind: 'online',
            providerId: 'bilibili',
            mediaId: bvid,
            providerData: {
                bvid,
                cid: cid ? Number(cid) : null,
                ...(pageCount > 1 ? { page: pageCount } : {}),
            },
        },
    };
};

export const normalizeBilibiliAlbum = (videoDetail: any): ProviderCollection => {
    const bvid = String(videoDetail.bvid || '');
    const title = cleanText(videoDetail.title || '');
    const coverUrl = ensureHttps(videoDetail.pic);
    const pages = Array.isArray(videoDetail.pages) ? videoDetail.pages : [];
    const authorName = cleanText(videoDetail.owner?.name || 'Bilibili');
    const authorMid = String(videoDetail.owner?.mid || '');

    return {
        providerId: 'bilibili',
        id: bvid,
        type: 'album',
        name: title,
        coverUrl,
        description: cleanText(videoDetail.desc || ''),
        trackCount: pages.length || 1,
        artists: [{
            id: authorMid || 'bilibili_up',
            name: authorName,
            catalogRef: authorMid ? { providerId: 'bilibili', kind: 'artist', id: authorMid } : undefined,
        }],
        isOwned: false,
    };
};

export const normalizeBilibiliPageSong = (page: any, videoDetail: any): UnifiedSong => {
    const bvid = String(videoDetail.bvid || '');
    const cid = String(page.cid || '');
    const pageNum = Number(page.page) || 1;
    const rawPart = cleanText(page.part || '');
    const title = rawPart || `${cleanText(videoDetail.title)} P${pageNum}`;
    const coverUrl = ensureHttps(page.first_frame || videoDetail.pic);
    const durationMs = (Number(page.duration) || 0) * 1000;
    const authorName = cleanText(videoDetail.owner?.name || 'Bilibili');
    const authorMid = String(videoDetail.owner?.mid || '');

    const artists: Artist[] = [{
        id: authorMid || 'bilibili_up',
        name: authorName,
        catalogRef: authorMid ? { providerId: 'bilibili', kind: 'artist', id: authorMid } : undefined,
    }];

    const mediaId = `${bvid}_${cid}`;

    return {
        id: mediaId,
        name: title,
        artists,
        album: {
            id: bvid,
            name: cleanText(videoDetail.title),
            coverUrl: ensureHttps(videoDetail.pic),
            catalogRef: { providerId: 'bilibili', kind: 'album', id: bvid },
        },
        durationMs,
        sourceRef: {
            kind: 'online',
            providerId: 'bilibili',
            mediaId,
            providerData: {
                bvid,
                cid: Number(cid),
                page: pageNum,
            },
        },
    };
};

export const normalizeBilibiliUser = (raw: any): ProviderUser => {
    return {
        id: String(raw.mid || raw.id || ''),
        nickname: cleanText(raw.uname || raw.nickname),
        avatarUrl: ensureHttps(raw.face || raw.avatarUrl),
        vipType: raw.vipType,
    };
};

export const normalizeBilibiliCollection = (raw: any): ProviderCollection => {
    const id = String(raw.id || raw.mediaId || '');
    const title = cleanText(raw.title || raw.name);
    const coverUrl = ensureHttps(raw.cover || raw.coverUrl);
    const trackCount = Number(raw.media_count ?? raw.trackCount) || 0;

    return {
        providerId: 'bilibili',
        id,
        type: 'playlist',
        name: title,
        coverUrl,
        description: cleanText(raw.intro || raw.description),
        trackCount,
        isOwned: true,
    };
};

export const bilibiliPage = <T>(items: T[], total: number, offset: number, limit: number): ProviderPage<T> => {
    const hasMore = offset + items.length < total;
    return {
        items,
        total,
        hasMore,
        nextOffset: offset + items.length,
    };
};
