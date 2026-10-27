import { beforeEach, describe, expect, it, vi } from 'vitest';

// test/unit/bilibili/bilibiliProvider.test.ts

const request = vi.hoisted(() => vi.fn());
vi.mock('@/services/onlineMusic/bilibili/bilibiliTransport', () => ({
    requestBilibili: request,
    getBilibiliTransportAvailability: () => ({ configured: true }),
}));

import { bilibiliProvider } from '@/services/onlineMusic/bilibili/bilibiliProvider';
import {
    bilibiliPage,
    ensureHttps,
    cleanText,
    normalizeBilibiliCollection,
    normalizeBilibiliSong,
    normalizeBilibiliUser,
} from '@/services/onlineMusic/bilibili/bilibiliNormalize';

const sampleVideo = {
    bvid: 'BV1xx411c7mD',
    cid: 1234567,
    title: '<em class="keyword">测试</em>视频标题',
    pic: '//i0.hdslb.com/bfs/archive/test.jpg',
    duration: 180,
    owner: { mid: 9999, name: '测试UP主' },
};

beforeEach(() => request.mockReset());

describe('Bilibili provider', () => {
    it('ensures HTTPS and strips HTML tags from titles', () => {
        expect(ensureHttps('//i0.hdslb.com/test.jpg')).toBe('https://i0.hdslb.com/test.jpg');
        expect(ensureHttps('http://i0.hdslb.com/test.jpg')).toBe('https://i0.hdslb.com/test.jpg');
        expect(cleanText('<em class="keyword">周杰伦</em> - 晴天')).toBe('周杰伦 - 晴天');
    });

    it('normalizes video item into UnifiedSong format', () => {
        const song = normalizeBilibiliSong(sampleVideo);
        expect(song.name).toBe('测试视频标题');
        expect(song.album.coverUrl).toBe('https://i0.hdslb.com/bfs/archive/test.jpg');
        expect(song.durationMs).toBe(180000);
        expect(song.artists[0].name).toBe('测试UP主');
        expect(song.sourceRef).toEqual({
            kind: 'online',
            providerId: 'bilibili',
            mediaId: 'BV1xx411c7mD',
            providerData: {
                bvid: 'BV1xx411c7mD',
                cid: 1234567,
            },
        });
    });

    it('fetches audio source by bvid and cid', async () => {
        request.mockResolvedValueOnce({
            url: 'https://upos-sz-mirror08c.bilivideo.com/test.m4a',
            fetchedAt: 1000,
            quality: 'high',
        });

        const song = normalizeBilibiliSong(sampleVideo);
        const audio = await bilibiliProvider.playback!.getAudioSource(song, 'high');
        expect(request).toHaveBeenCalledWith('audio', {
            bvid: 'BV1xx411c7mD',
            cid: 1234567,
            quality: 'high',
        });
        expect(audio?.url).toBe('https://upos-sz-mirror08c.bilivideo.com/test.m4a');
    });

    it('handles QR code login flow', async () => {
        request.mockResolvedValueOnce({ key: 'test_qr_key', url: 'https://passport.bilibili.com/...' });
        const key = await bilibiliProvider.auth!.startLogin!();
        expect(key).toBe('test_qr_key');

        request.mockResolvedValueOnce({ state: 'waiting' });
        const pollResult = await bilibiliProvider.auth!.checkLogin!(key);
        expect(pollResult).toEqual({ state: 'waiting' });
    });

    it('fetches user playlists and normalizes favorite folders', async () => {
        request.mockResolvedValueOnce({
            list: [
                { id: 1001, title: '我的我喜欢', cover: '//i1.hdslb.com/cover.jpg', media_count: 50 },
            ],
            total: 1,
        });

        const playlists = await bilibiliProvider.library!.getUserPlaylists('9999', 20, 0);
        expect(playlists.items.length).toBe(1);
        expect(playlists.items[0].name).toBe('我的我喜欢');
        expect(playlists.items[0].coverUrl).toBe('https://i1.hdslb.com/cover.jpg');
        expect(playlists.items[0].trackCount).toBe(50);
        expect(playlists.items[0].providerId).toBe('bilibili');
    });

    it('fetches multi-part video as album and individual tracks', async () => {
        request.mockResolvedValueOnce({
            bvid: 'BV1xx411c7mD',
            title: '测试合辑',
            pic: '//i1.hdslb.com/album.jpg',
            owner: { name: '测试UP主', mid: 9999 },
            pages: [
                { cid: 101, page: 1, part: '01. 第一首', duration: 180 },
                { cid: 102, page: 2, part: '02. 第二首', duration: 200 },
            ],
        });

        const album = await bilibiliProvider.catalog!.getAlbumDetail!('BV1xx411c7mD');
        expect(album?.name).toBe('测试合辑');
        expect(album?.trackCount).toBe(2);

        request.mockResolvedValueOnce({
            bvid: 'BV1xx411c7mD',
            title: '测试合辑',
            pic: '//i1.hdslb.com/album.jpg',
            owner: { name: '测试UP主', mid: 9999 },
            pages: [
                { cid: 101, page: 1, part: '01. 第一首', duration: 180 },
                { cid: 102, page: 2, part: '02. 第二首', duration: 200 },
            ],
        });

        const tracks = await bilibiliProvider.catalog!.getAlbumTracks!('BV1xx411c7mD', 10, 0);
        expect(tracks.items.length).toBe(2);
        expect(tracks.items[0].id).toBe('BV1xx411c7mD_101');
        expect(tracks.items[0].name).toBe('01. 第一首');
        expect((tracks.items[0].sourceRef as any)?.providerData?.cid).toBe(101);
        expect(tracks.items[1].id).toBe('BV1xx411c7mD_102');
        expect(tracks.items[1].name).toBe('02. 第二首');
        expect((tracks.items[1].sourceRef as any)?.providerData?.cid).toBe(102);
    });
});
