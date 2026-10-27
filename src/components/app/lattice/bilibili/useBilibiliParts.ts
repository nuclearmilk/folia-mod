import { useEffect, useState } from 'react';
import type { SongResult, UnifiedSong } from '../../../../types';
import { omni } from '../../../../services/onlineMusic/omni';

interface VideoPartsCacheEntry {
    title: string;
    tracks: UnifiedSong[];
}

const partsCache = new Map<string, VideoPartsCacheEntry>();

export function useBilibiliParts(currentSong: SongResult | null) {
    const isBilibili = currentSong?.sourceRef?.kind === 'online' && currentSong.sourceRef.providerId === 'bilibili';
    const sourceRef = currentSong?.sourceRef?.kind === 'online' ? currentSong.sourceRef : null;
    const bvid = isBilibili
        ? String(sourceRef?.providerData?.bvid || sourceRef?.mediaId || currentSong?.album?.id || '').split('_')[0]
        : '';
    const currentCid = isBilibili ? Number(sourceRef?.providerData?.cid || 0) : 0;

    const [partsData, setPartsData] = useState<VideoPartsCacheEntry | null>(() => {
        return bvid ? partsCache.get(bvid) ?? null : null;
    });

    useEffect(() => {
        if (!bvid || !isBilibili) {
            setPartsData(null);
            return;
        }

        const cached = partsCache.get(bvid);
        if (cached) {
            setPartsData(cached);
            return;
        }

        let cancelled = false;
        const albumCollection = {
            providerId: 'bilibili' as const,
            id: bvid,
            type: 'album' as const,
            name: currentSong?.album?.name || '',
        };

        omni.getCollectionTracks(albumCollection, { limit: 200, offset: 0 })
            .then(page => {
                if (cancelled) return;
                const tracks = page.items || [];
                const entry: VideoPartsCacheEntry = {
                    title: currentSong?.album?.name || currentSong?.name || '',
                    tracks,
                };
                partsCache.set(bvid, entry);
                setPartsData(entry);
            })
            .catch(() => {
                if (!cancelled) setPartsData(null);
            });

        return () => {
            cancelled = true;
        };
    }, [bvid, isBilibili, currentSong?.album?.name, currentSong?.name]);

    const tracks = partsData?.tracks || [];
    const hasParts = tracks.length > 1;

    return {
        isBilibili,
        hasParts,
        bvid,
        currentCid,
        title: partsData?.title || '',
        tracks,
    };
}
