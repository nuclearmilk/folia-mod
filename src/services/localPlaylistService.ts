import { LocalPlaylist, LocalSong, SongResult } from '../types';
import { getFromCache, getLocalSongs, saveToCache } from './db';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';

const LOCAL_PLAYLISTS_CACHE_KEY = 'local_playlists';
const CUSTOM_PLAYLIST_TRACK_PREFIX = 'custom_playlist_track_';
const FAVORITE_PLAYLIST_NAME = 'Liked Songs';
const UNNAMED_PLAYLIST_NAME = 'Untitled Playlist';

const createPlaylistId = () => `local_playlist_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

type LegacyPlaylistSongRef = string | Pick<LocalSong, 'id'> | null | undefined;
type LegacyLocalPlaylist = Partial<LocalPlaylist> & {
    songs?: LegacyPlaylistSongRef[];
    tracks?: LegacyPlaylistSongRef[];
    trackIds?: string[];
};

const dedupeSongIds = (songIds: string[]) => {
    const seen = new Set<string>();
    const deduped: string[] = [];

    songIds.forEach(songId => {
        if (!songId || seen.has(songId)) {
            return;
        }

        seen.add(songId);
        deduped.push(songId);
    });

    return deduped;
};

const DUPLICATE_IMPORT_ROOT_SUFFIX = /\s\(\d+\)$/;

const getRootFolderName = (song: LocalSong): string => {
    const pathLike = song.filePath || song.folderName || '';
    return pathLike.split('/')[0] || '';
};

const getDuplicateImportRootBase = (rootFolderName: string): string => (
    rootFolderName.replace(DUPLICATE_IMPORT_ROOT_SUFFIX, '')
);

const getRelativePathWithoutRoot = (song: LocalSong): string | null => {
    if (!song.filePath) {
        return null;
    }

    const rootFolderName = getRootFolderName(song);
    return rootFolderName && song.filePath.startsWith(`${rootFolderName}/`)
        ? song.filePath.slice(rootFolderName.length + 1)
        : song.filePath;
};

const getDuplicateImportSongKey = (song: LocalSong): string | null => {
    const relativePath = getRelativePathWithoutRoot(song);
    if (!relativePath || typeof song.fileSize !== 'number' || typeof song.fileLastModified !== 'number') {
        return null;
    }

    return `${getDuplicateImportRootBase(getRootFolderName(song))}::${relativePath}::${song.fileSize}::${song.fileLastModified}`;
};

const isPreferredDuplicateImportCanonical = (candidate: LocalSong, current: LocalSong): boolean => {
    const candidateRoot = getRootFolderName(candidate);
    const currentRoot = getRootFolderName(current);
    const candidateLooksDuplicated = DUPLICATE_IMPORT_ROOT_SUFFIX.test(candidateRoot);
    const currentLooksDuplicated = DUPLICATE_IMPORT_ROOT_SUFFIX.test(currentRoot);

    if (candidateLooksDuplicated !== currentLooksDuplicated) {
        return !candidateLooksDuplicated;
    }

    if ((candidate.addedAt || 0) !== (current.addedAt || 0)) {
        return (candidate.addedAt || 0) < (current.addedAt || 0);
    }

    return candidate.id.localeCompare(current.id) < 0;
};

const buildDuplicateImportCanonicalSongIds = (songs: LocalSong[]): Map<string, string> => {
    const canonicalSongs = new Map<string, LocalSong>();

    songs.forEach(song => {
        const duplicateKey = getDuplicateImportSongKey(song);
        if (!duplicateKey) {
            return;
        }

        const currentCanonical = canonicalSongs.get(duplicateKey);
        if (!currentCanonical || isPreferredDuplicateImportCanonical(song, currentCanonical)) {
            canonicalSongs.set(duplicateKey, song);
        }
    });

    return new Map(Array.from(canonicalSongs.entries()).map(([duplicateKey, song]) => [duplicateKey, song.id]));
};

/**
 * 歌单里存的是"重复导入组"的 canonical id（见 repairPlaylistSongIds），而正在播放的可能是同一文件
 * 的另一份副本。判断收藏和写入收藏都必须先换算到同一把尺子，否则写进去的 id 和读出来的对不上。
 */
export const buildCanonicalLocalSongIdIndex = (songs: LocalSong[]): Map<string, string> => {
    const canonicalByDuplicateKey = buildDuplicateImportCanonicalSongIds(songs);
    const index = new Map<string, string>();

    songs.forEach(song => {
        const duplicateKey = getDuplicateImportSongKey(song);
        const canonicalSongId = duplicateKey ? canonicalByDuplicateKey.get(duplicateKey) : undefined;
        if (canonicalSongId && canonicalSongId !== song.id) {
            index.set(song.id, canonicalSongId);
        }
    });

    return index;
};

export const resolveCanonicalLocalSongId = (songId: string, songs: LocalSong[]): string => {
    const song = songs.find(candidate => candidate.id === songId);
    if (!song) {
        return songId;
    }

    const duplicateKey = getDuplicateImportSongKey(song);
    if (!duplicateKey) {
        return songId;
    }

    return buildDuplicateImportCanonicalSongIds(songs).get(duplicateKey) || songId;
};

export const isCustomPlaylistTrackKey = (songId: string): boolean => (
    songId.startsWith('online:') || songId.startsWith('navidrome:')
);

export const getCustomPlaylistTrackCacheKey = (playbackKey: string): string => (
    `${CUSTOM_PLAYLIST_TRACK_PREFIX}${playbackKey}`
);

const inMemoryCustomTrackCache = new Map<string, SongResult>();

export const getCachedCustomPlaylistTrack = (playbackKey: string): SongResult | null => (
    inMemoryCustomTrackCache.get(playbackKey) ?? null
);

export const saveCustomPlaylistTrack = async (song: SongResult): Promise<string> => {
    const key = getPlaybackSongKey(song);
    inMemoryCustomTrackCache.set(key, song);
    await saveToCache(getCustomPlaylistTrackCacheKey(key), song);
    return key;
};

export const saveCustomPlaylistTracks = async (songs: SongResult[]): Promise<string[]> => {
    return Promise.all(songs.map(song => saveCustomPlaylistTrack(song)));
};

export const getCustomPlaylistTrack = async (playbackKey: string): Promise<SongResult | null> => {
    if (inMemoryCustomTrackCache.has(playbackKey)) {
        return inMemoryCustomTrackCache.get(playbackKey)!;
    }
    const cached = await getFromCache<SongResult>(getCustomPlaylistTrackCacheKey(playbackKey));
    if (cached) {
        inMemoryCustomTrackCache.set(playbackKey, cached);
    }
    return cached;
};

export const getCustomPlaylistTracks = async (playbackKeys: string[]): Promise<Map<string, SongResult>> => {
    const map = new Map<string, SongResult>();
    const uniqueKeys = Array.from(new Set(playbackKeys.filter(isCustomPlaylistTrackKey)));
    if (!uniqueKeys.length) return map;

    const missingKeys: string[] = [];
    uniqueKeys.forEach(key => {
        const memoryHit = inMemoryCustomTrackCache.get(key);
        if (memoryHit) {
            map.set(key, memoryHit);
        } else {
            missingKeys.push(key);
        }
    });

    if (missingKeys.length > 0) {
        const entries = await Promise.all(
            missingKeys.map(async key => {
                const track = await getFromCache<SongResult>(getCustomPlaylistTrackCacheKey(key));
                if (track) {
                    inMemoryCustomTrackCache.set(key, track);
                }
                return [key, track] as const;
            })
        );

        entries.forEach(([key, track]) => {
            if (track) {
                map.set(key, track);
            }
        });
    }

    return map;
};

const repairPlaylistSongIds = (
    songIds: string[],
    validSongById: Map<string, LocalSong>,
    duplicateCanonicalSongIds: Map<string, string>
): { songIds: string[]; changed: boolean; } => {
    const seen = new Set<string>();
    const repairedSongIds: string[] = [];
    let changed = false;

    songIds.forEach(songId => {
        if (isCustomPlaylistTrackKey(songId)) {
            if (seen.has(songId)) {
                changed = true;
                return;
            }
            seen.add(songId);
            repairedSongIds.push(songId);
            return;
        }

        const song = validSongById.get(songId);
        if (!song) {
            changed = true;
            return;
        }

        const duplicateKey = getDuplicateImportSongKey(song);
        const canonicalSongId = duplicateKey ? duplicateCanonicalSongIds.get(duplicateKey) || songId : songId;
        if (canonicalSongId !== songId) {
            changed = true;
        }

        if (seen.has(canonicalSongId)) {
            changed = true;
            return;
        }

        seen.add(canonicalSongId);
        repairedSongIds.push(canonicalSongId);
    });

    return { songIds: repairedSongIds, changed };
};

const normalizeSongIdRef = (value: LegacyPlaylistSongRef): string | null => {
    if (typeof value === 'string') {
        return value;
    }

    if (value && typeof value === 'object' && typeof value.id === 'string') {
        return value.id;
    }

    return null;
};

// Reads legacy playlist payloads and converts them into the current song-id-only shape.
const resolvePlaylistSongIds = (playlist: LegacyLocalPlaylist): string[] => {
    const candidateCollections: LegacyPlaylistSongRef[][] = [];

    if (Array.isArray(playlist.songIds)) {
        candidateCollections.push(playlist.songIds as LegacyPlaylistSongRef[]);
    }

    if (Array.isArray(playlist.trackIds)) {
        candidateCollections.push(playlist.trackIds);
    }

    if (Array.isArray(playlist.songs)) {
        candidateCollections.push(playlist.songs);
    }

    if (Array.isArray(playlist.tracks)) {
        candidateCollections.push(playlist.tracks);
    }

    for (const collection of candidateCollections) {
        const normalized = dedupeSongIds(
            collection
                .map(normalizeSongIdRef)
                .filter((songId): songId is string => Boolean(songId))
        );

        if (normalized.length > 0) {
            return normalized;
        }
    }

    return [];
};

const normalizePlaylist = (playlist: LegacyLocalPlaylist): LocalPlaylist => ({
    id: typeof playlist.id === 'string' && playlist.id ? playlist.id : createPlaylistId(),
    name: typeof playlist.name === 'string' && playlist.name
        ? playlist.name
        : (playlist.isFavorite ? FAVORITE_PLAYLIST_NAME : UNNAMED_PLAYLIST_NAME),
    songIds: resolvePlaylistSongIds(playlist),
    createdAt: typeof playlist.createdAt === 'number' ? playlist.createdAt : Date.now(),
    updatedAt: typeof playlist.updatedAt === 'number' ? playlist.updatedAt : Date.now(),
    isFavorite: Boolean(playlist.isFavorite),
});

const playlistNeedsNormalization = (playlist: LegacyLocalPlaylist): boolean => {
    if (!Array.isArray(playlist.songIds)) {
        return true;
    }

    if (Array.isArray(playlist.songs) || Array.isArray(playlist.tracks) || Array.isArray(playlist.trackIds)) {
        return true;
    }

    const normalizedSongIds = resolvePlaylistSongIds(playlist);
    if (normalizedSongIds.length !== playlist.songIds.length) {
        return true;
    }

    if (normalizedSongIds.some((songId, index) => songId !== playlist.songIds?.[index])) {
        return true;
    }

    return typeof playlist.createdAt !== 'number' || typeof playlist.updatedAt !== 'number';
};

const persistPlaylists = async (playlists: LocalPlaylist[]) => {
    await saveToCache(LOCAL_PLAYLISTS_CACHE_KEY, playlists.map(normalizePlaylist));
};

export const getLocalPlaylists = async (): Promise<LocalPlaylist[]> => {
    const cached = await getFromCache<LegacyLocalPlaylist[]>(LOCAL_PLAYLISTS_CACHE_KEY);
    const cachedPlaylists = Array.isArray(cached) ? cached : [];
    const localSongs = await getLocalSongs();
    const validSongById = new Map(localSongs.map(song => [song.id, song]));
    const duplicateCanonicalSongIds = buildDuplicateImportCanonicalSongIds(localSongs);
    let shouldPersist = cachedPlaylists.some(playlistNeedsNormalization);
    const playlists = cachedPlaylists.map(normalizePlaylist).map(playlist => {
        const repaired = repairPlaylistSongIds(playlist.songIds, validSongById, duplicateCanonicalSongIds);
        if (repaired.changed) {
            shouldPersist = true;
            return {
                ...playlist,
                songIds: repaired.songIds,
            };
        }

        return playlist;
    });

    const favoritePlaylist = playlists.find(playlist => playlist.isFavorite);
    if (!favoritePlaylist) {
        const nextPlaylists: LocalPlaylist[] = [
            {
                id: createPlaylistId(),
                name: FAVORITE_PLAYLIST_NAME,
                songIds: [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isFavorite: true,
            },
            ...playlists,
        ];
        await persistPlaylists(nextPlaylists);
        return nextPlaylists;
    }

    if (shouldPersist) {
        await persistPlaylists(playlists);
    }

    return playlists;
};

export const saveLocalPlaylists = async (playlists: LocalPlaylist[]): Promise<LocalPlaylist[]> => {
    const normalized = playlists.map(normalizePlaylist);
    await persistPlaylists(normalized);
    return normalized;
};

export const createLocalPlaylist = async (name: string, songs: (LocalSong | SongResult)[] = []): Promise<LocalPlaylist> => {
    const playlists = await getLocalPlaylists();
    const now = Date.now();
    const songIds: string[] = [];
    for (const song of songs) {
        if ('filePath' in song && typeof (song as LocalSong).id === 'string') {
            songIds.push((song as LocalSong).id);
        } else {
            const track = song as SongResult;
            await saveCustomPlaylistTrack(track);
            songIds.push(getPlaybackSongKey(track));
        }
    }

    const playlist: LocalPlaylist = {
        id: createPlaylistId(),
        name: name.trim(),
        songIds: dedupeSongIds(songIds),
        createdAt: now,
        updatedAt: now,
    };

    await persistPlaylists([...playlists, playlist]);
    return playlist;
};

export const updateLocalPlaylist = async (
    playlistId: string,
    updater: (playlist: LocalPlaylist) => LocalPlaylist
): Promise<LocalPlaylist | null> => {
    const playlists = await getLocalPlaylists();
    let updatedPlaylist: LocalPlaylist | null = null;

    const nextPlaylists = playlists.map(playlist => {
        if (playlist.id !== playlistId) {
            return playlist;
        }

        updatedPlaylist = normalizePlaylist({
            ...updater(playlist),
            updatedAt: Date.now(),
        });
        return updatedPlaylist;
    });

    if (!updatedPlaylist) {
        return null;
    }

    await persistPlaylists(nextPlaylists);
    return updatedPlaylist;
};

export const deleteLocalPlaylist = async (playlistId: string): Promise<void> => {
    const playlists = await getLocalPlaylists();
    const target = playlists.find(playlist => playlist.id === playlistId);
    if (!target || target.isFavorite) {
        return;
    }

    await persistPlaylists(playlists.filter(playlist => playlist.id !== playlistId));
};

export const canDeleteLocalPlaylist = (playlist: LocalPlaylist | null | undefined): boolean => {
    return Boolean(playlist && !playlist.isFavorite);
};

export const addSongIdsToLocalPlaylist = async (playlistId: string, songIds: string[]): Promise<LocalPlaylist | null> => (
    updateLocalPlaylist(playlistId, playlist => ({
        ...playlist,
        songIds: dedupeSongIds([...playlist.songIds, ...songIds]),
    }))
);

export const addSongsToLocalPlaylist = async (playlistId: string, songs: (LocalSong | SongResult)[]): Promise<LocalPlaylist | null> => {
    const songIds: string[] = [];
    for (const song of songs) {
        if ('filePath' in song && typeof (song as LocalSong).id === 'string') {
            songIds.push((song as LocalSong).id);
        } else {
            const track = song as SongResult;
            await saveCustomPlaylistTrack(track);
            songIds.push(getPlaybackSongKey(track));
        }
    }
    return addSongIdsToLocalPlaylist(playlistId, songIds);
};

export const removeSongsFromLocalPlaylist = async (playlistId: string, songIds: string[]): Promise<LocalPlaylist | null> => {
    const removingIds = new Set(songIds);
    return updateLocalPlaylist(playlistId, playlist => ({
        ...playlist,
        songIds: playlist.songIds.filter(songId => !removingIds.has(songId)),
    }));
};

export const reorderLocalPlaylistSongs = async (
    playlistId: string,
    songIds: string[]
): Promise<LocalPlaylist | null> => updateLocalPlaylist(playlistId, playlist => ({
    ...playlist,
    songIds: dedupeSongIds(songIds),
}));

export const getFavoriteLocalPlaylist = async (): Promise<LocalPlaylist> => {
    const playlists = await getLocalPlaylists();
    const favoritePlaylist = playlists.find(playlist => playlist.isFavorite);

    if (!favoritePlaylist) {
        const created = await createLocalPlaylist(FAVORITE_PLAYLIST_NAME);
        return {
            ...created,
            isFavorite: true,
        };
    }

    return favoritePlaylist;
};

export const setLocalSongFavorite = async (song: LocalSong, shouldFavorite: boolean): Promise<LocalPlaylist | null> => {
    const favoritePlaylist = await getFavoriteLocalPlaylist();
    const canonicalSongId = resolveCanonicalLocalSongId(song.id, await getLocalSongs());

    if (shouldFavorite) {
        return addSongIdsToLocalPlaylist(favoritePlaylist.id, [canonicalSongId]);
    }

    return removeSongsFromLocalPlaylist(favoritePlaylist.id, [canonicalSongId]);
};
