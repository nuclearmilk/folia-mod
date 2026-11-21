import { beforeEach, describe, expect, it, vi } from 'vitest';

const reactHooks = vi.hoisted(() => {
    const refs: { current: unknown }[] = [];
    const effects: Array<() => unknown> = [];
    let cursor = 0;
    return {
        refs,
        effects,
        startRender() {
            cursor = 0;
            effects.length = 0;
        },
        useRef(initial: unknown) {
            refs[cursor] ??= { current: initial };
            return refs[cursor++];
        },
        flush() {
            effects.forEach(effect => { effect(); });
        },
    };
});

vi.mock('react', () => ({
    useCallback: (callback: unknown) => callback,
    useMemo: (factory: () => unknown) => factory(),
    useRef: (initial: unknown) => reactHooks.useRef(initial),
    useEffect: (effect: () => unknown) => { reactHooks.effects.push(effect); },
}));

const playbackState = vi.hoisted(() => ({
    audioSrc: null as string | null,
    currentSong: null,
    replayGainMode: 'off',
}));
const setPlayerStateMock = vi.hoisted(() => vi.fn());
vi.mock('../../../src/stores/usePlaybackStore', () => ({
    usePlaybackStore: (selector: (state: typeof playbackState) => unknown) => selector(playbackState),
    setPlayerState: setPlayerStateMock,
}));
vi.mock('../../../src/stores/useAudioSettingsStore', () => ({
    useAudioSettingsStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
        enableMediaCache: false,
        audioEqualizerSettings: { enabled: false, effects: {}, bands: [] },
        audioEqualizerModCurve: null,
    }),
}));
vi.mock('../../../src/stores/useAppViewStore', () => ({
    useAppViewStore: (selector: (state: Record<string, unknown>) => unknown) => selector({
        isPanelOpen: false,
        panelTab: 'queue',
    }),
}));
vi.mock('../../../src/stores/useStatusMessageStore', () => ({ setStatusMessage: vi.fn() }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('../../../src/utils/appPlaybackGuards', () => ({ resolveNavidromePlaybackCarrier: () => null }));
vi.mock('../../../src/utils/replayGain', () => ({ calculateReplayGain: () => ({ linearGain: 1 }) }));
vi.mock('../../../src/services/audioEqualizerGraph', () => ({
    applyAudioEqualizerSettings: vi.fn(),
    planAudioEqualizerApply: () => ({ defer: false, timeConstant: 0.015 }),
}));
vi.mock('../../../src/services/playbackGraph', () => ({ buildPlaybackGraph: vi.fn() }));
vi.mock('../../../src/services/playedTrackCache', () => ({ cachePlayedTrackAssets: vi.fn() }));
vi.mock('../../../src/services/automix/crossfadeGraph', () => ({ rampGain: vi.fn() }));
vi.mock('../../../src/services/automix/profileService', () => ({ onTrackProfile: () => () => undefined }));
vi.mock('../../../src/services/volumeBalance/balancePlay', () => ({ createBalancePlay: () => ({ apply: () => null, reset: () => undefined }) }));
vi.mock('../../../src/services/volumeBalance/balanceRecords', () => ({ onBalanceRecord: () => () => undefined }));

const { usePlaybackAudioBridge } = await import('../../../src/components/app/playback/bridges/usePlaybackAudioBridge');

const TRACK_SRC = 'https://music.test/track.mp3';

const createDeck = () => ({
    error: null,
    paused: true,
    ended: false,
    getAttribute: (name: string) => (name === 'src' ? TRACK_SRC : null),
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    load: vi.fn(),
});

const renderBridge = (
    deck: ReturnType<typeof createDeck>,
    shouldAutoPlayRef: { current: boolean },
    { isLyricsLoading, isAutoplayHeld = false }: { isLyricsLoading: boolean; isAutoplayHeld?: boolean },
) => {
    playbackState.audioSrc = TRACK_SRC;
    reactHooks.startRender();
    usePlaybackAudioBridge({
        audioRef: { current: deck as unknown as HTMLAudioElement },
        localSongs: [],
        isLyricsLoading,
        shouldAutoPlayRef,
        audioContextRef: { current: null },
        analyserRef: { current: null },
        gainNodeRef: { current: null },
        connectDecks: () => true,
        getActiveChain: () => null,
        suppressAutoplayRef: { current: false },
        isAutoplayHeld,
        syncOutputGain: vi.fn(),
        getTargetPlaybackVolume: () => 1,
        getCoverUrl: () => null,
    } as never);
    reactHooks.flush();
};

describe('web audio autoplay starts before lyrics finish loading', () => {
    beforeEach(() => {
        reactHooks.refs.length = 0;
        setPlayerStateMock.mockClear();
        globalThis.localStorage = { setItem: () => {}, getItem: () => null } as never;
    });

    it('calls audio.play() immediately even while isLyricsLoading is true', () => {
        const deck = createDeck();
        const shouldAutoPlayRef = { current: true };

        renderBridge(deck, shouldAutoPlayRef, { isLyricsLoading: true });

        expect(deck.play).toHaveBeenCalledTimes(1);
        expect(shouldAutoPlayRef.current).toBe(false);
    });

    it('still holds autoplay for automix transitions when isAutoplayHeld is true', () => {
        const deck = createDeck();
        const shouldAutoPlayRef = { current: true };

        renderBridge(deck, shouldAutoPlayRef, { isLyricsLoading: true, isAutoplayHeld: true });

        expect(deck.play).not.toHaveBeenCalled();
        expect(shouldAutoPlayRef.current).toBe(true);
    });
});
