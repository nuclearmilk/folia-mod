// src/services/onlineMusic/bilibili/bilibiliProvider.ts
// Bilibili online music provider implementation.

import type { OnlineMusicProvider, ProviderAudioSource, ProviderCollection, LoginState } from '../../../types/onlineMusic';
import { OnlineProviderError } from '../../../types/onlineMusic';
import { createProviderSongMetadata } from '../../../utils/songMetadata';
import { getBilibiliTransportAvailability, requestBilibili } from './bilibiliTransport';
import {
    bilibiliPage,
    normalizeBilibiliAlbum,
    normalizeBilibiliCollection,
    normalizeBilibiliPageSong,
    normalizeBilibiliSong,
    normalizeBilibiliUser,
} from './bilibiliNormalize';

export const bilibiliProvider: OnlineMusicProvider = {
    id: 'bilibili',
    displayName: '哔哩哔哩',
    shortName: 'B站',
    mark: { letter: '哔', color: '#00aeec' },
    getAvailability: getBilibiliTransportAvailability,
    capabilities: {
        search: true,
        playback: true,
        lyrics: false,
        wordByWordLyrics: false,
        auth: true,
        playlists: true,
        albums: false,
        artists: false,
        recommendations: false,
        userLibrary: true,
        mutations: false,
    },
    normalizeSong: normalizeBilibiliSong,
    normalizeUser: normalizeBilibiliUser,
    normalizeCollection: normalizeBilibiliCollection,
    songMetadata: { getSongMetadata: createProviderSongMetadata },
    search: {
        async searchSongs(query, limit, offset) {
            if (!query.trim()) return bilibiliPage([], 0, offset, limit);
            const page = Math.floor(offset / limit) + 1;
            const data = await requestBilibili<any>('search', { query, page });
            const items = Array.isArray(data.items) ? data.items.map(normalizeBilibiliSong) : [];
            return bilibiliPage(items, Number(data.total) || items.length, offset, limit);
        },
    },
    playback: {
        async getSongDetail(id) {
            const idStr = String(id);
            if (idStr.includes('_')) {
                const [bvid, cidStr] = idStr.split('_');
                const cid = Number(cidStr);
                const data = await requestBilibili<any>('video_detail', { bvid });
                const page = Array.isArray(data?.pages) ? data.pages.find((p: any) => p.cid === cid) : null;
                if (page) {
                    return normalizeBilibiliPageSong(page, data);
                }
                return normalizeBilibiliSong(data);
            }
            const detail = await requestBilibili<any>('video_detail', { bvid: idStr });
            return normalizeBilibiliSong(detail);
        },
        async getAudioSource(song, quality) {
            const source = song.sourceRef;
            if (source?.kind !== 'online' || source.providerId !== 'bilibili') {
                throw new OnlineProviderError('unsupported', 'Song does not belong to Bilibili', 'bilibili');
            }
            const bvid = String(source.providerData?.bvid || source.mediaId).split('_')[0];
            let cid = source.providerData?.cid;

            if (!cid) {
                // Fetch video detail to resolve default cid
                const detail = await requestBilibili<any>('video_detail', { bvid });
                cid = detail?.cid || detail?.pages?.[0]?.cid;
            }

            if (!cid) {
                throw new OnlineProviderError('not-playable', 'Cannot resolve CID for Bilibili video', 'bilibili');
            }

            const audio = await requestBilibili<ProviderAudioSource>('audio', {
                bvid,
                cid,
                quality,
            });

            // If running in browser without Electron, route audio stream through dev proxy to bypass Referer anti-hotlink
            if (typeof window !== 'undefined' && !(window as any).electron?.bilibiliRequest && audio?.url) {
                audio.url = `/api/bilibili-media?url=${encodeURIComponent(audio.url)}`;
            }

            return audio;
        },
    },
    auth: {
        getLoginTexts: () => ({ title: 'home.loginTitleBilibili', note: 'home.loginNoteBilibili' }),
        getLoginStatus: async () => {
            const rawUser = await requestBilibili<any>('login_status');
            return rawUser ? normalizeBilibiliUser(rawUser) : null;
        },
        async logout() {
            await requestBilibili('logout');
        },
        async startLogin() {
            const res = await requestBilibili<{ key: string }>('login_qr_key');
            return res.key;
        },
        async createQr(key) {
            const res = await requestBilibili<{ imageUrl: string }>('login_qr_create', { key });
            return res.imageUrl;
        },
        checkLogin: (key) => requestBilibili<LoginState>('login_qr_check', { key }),
        getLoginTtlMs: () => 3 * 60 * 1000,
    },
    library: {
        async getUserPlaylists(userId, limit, offset) {
            const data = await requestBilibili<any>('user_playlists', { userId });
            const list = Array.isArray(data.list) ? data.list.map(normalizeBilibiliCollection) : [];
            return bilibiliPage(list, data.total || list.length, offset, limit);
        },
    },
    catalog: {
        canResolveSongCatalogRefs: song => song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'bilibili',
        resolveSongCatalogRefs: async song => song,
        async getPlaylistDetail(id, collection) {
            if (collection && collection.trackCount !== undefined && collection.trackCount > 0) return collection;
            const data = await requestBilibili<any>('playlist_detail', { id, page: 1, pageSize: 1 });
            return normalizeBilibiliCollection(data.info || { id });
        },
        async getPlaylistTracks(id, limit, offset) {
            const BATCH_SIZE = 20;
            const page = Math.floor(offset / BATCH_SIZE) + 1;
            const data = await requestBilibili<any>('playlist_detail', { id, page, pageSize: BATCH_SIZE });
            const medias = Array.isArray(data.medias) ? data.medias.map(normalizeBilibiliSong) : [];
            return bilibiliPage(medias, data.total || medias.length, offset, limit);
        },
        async getAlbumDetail(id) {
            const data = await requestBilibili<any>('video_detail', { bvid: String(id) });
            return normalizeBilibiliAlbum(data);
        },
        async getAlbumTracks(id, limit = 100, offset = 0) {
            const data = await requestBilibili<any>('video_detail', { bvid: String(id) });
            const pages = Array.isArray(data?.pages) ? data.pages : [];
            const songs = pages.map((page: any) => normalizeBilibiliPageSong(page, data));
            return bilibiliPage(songs.slice(offset, offset + limit), songs.length, offset, limit);
        },
    },
};
