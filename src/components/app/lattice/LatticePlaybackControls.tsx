import { motionValue } from 'framer-motion';
import { AnimatePresence } from 'framer-motion';
import { ArrowUpRight, Menu, Pause, Play } from 'lucide-react';
import { useContext, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import ProgressBar from '../../ProgressBar';
import { PlayerState, type UnifiedSong } from '../../../types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { LatticeSongActionsContext } from './LatticeSongActionsContext';
import { useLatticeTransport } from './LatticeTransportContext';
import type { LatticeSongTile } from './latticeModel';
import { LatticeBilibiliPartsPopup } from './bilibili/LatticeBilibiliPartsPopup';
import { useBilibiliParts } from './bilibili/useBilibiliParts';
import LatticeChromeTime from './LatticeChromeTime';
import LatticeExtraControls from './LatticeExtraControls';
import './LatticeChrome.css';

// Adapts the shared Player Chrome transport and progress bar to one expanded wall tile.

type LatticePlaybackControlsProps = {
    revealed: boolean;
    tile: LatticeSongTile;
    onPlay: (tile: LatticeSongTile) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    onOpenPlayer: () => void;
};

const idleTime = motionValue(0);
const ignoreSeek = () => { };

export default function LatticePlaybackControls({
    revealed,
    tile,
    onPlay,
    onTogglePlayback,
    onSeek,
    onOpenPlayer,
}: LatticePlaybackControlsProps) {
    const { t } = useTranslation();
    // Subscribed here rather than threaded through every poster: only this card reads transport state.
    const { currentSong, playerState, currentTime, playbackDuration, canTogglePlayback } = useLatticeTransport();
    const isCurrentSong = Boolean(
        currentSong && getPlaybackSongKey(currentSong) === getPlaybackSongKey(tile.song),
    );
    const canControlCurrent = isCurrentSong && canTogglePlayback;
    const isPlaying = canControlCurrent && playerState === PlayerState.PLAYING;
    const duration = canControlCurrent
        ? playbackDuration
        : Math.max(0, tile.song.durationMs / 1000);

    const targetSong = isCurrentSong ? currentSong : tile.song;
    const { hasParts, title: videoTitle, tracks, currentCid } = useBilibiliParts(targetSong);
    const [showPartsPopup, setShowPartsPopup] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const songActions = useContext(LatticeSongActionsContext);

    const handleTogglePopup = () => {
        setShowPartsPopup(open => !open);
    };

    const handleSelectPart = (partSong: UnifiedSong) => {
        if (songActions?.onPlaySong) {
            songActions.onPlaySong(partSong);
        } else {
            onPlay({
                ...tile,
                song: partSong,
            });
        }
    };

    const isRevealed = revealed || showPartsPopup;

    return (
        <div
            // 思索靠这个属性认出整条控制条。类名会随样式重构改名，属性不会 —— 见 ponderSelectorContract。
            data-ponder="lattice-chrome"
            className={`lattice-chrome ${isRevealed ? 'is-revealed' : ''}`}
            role="group"
            aria-label={t('home.latticePlaybackControls')}
        >
            <div className="lattice-chrome-transport">
                <button
                    type="button"
                    className="lattice-transport-button"
                    onClick={() => canControlCurrent ? onTogglePlayback() : onPlay(tile)}
                    aria-label={isPlaying ? t('player.pause') : t('player.play')}
                    title={isPlaying ? t('player.pause') : t('player.play')}
                >
                    {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
                </button>
                <div className="lattice-chrome-details" inert={!isRevealed} aria-hidden={!isRevealed}>
                    <LatticeExtraControls disabled={!canControlCurrent} />
                </div>
                {hasParts && (
                    <div className="lattice-chrome-parts-anchor">
                        <button
                            ref={buttonRef}
                            type="button"
                            className={`lattice-secondary-action lattice-parts-button ${showPartsPopup ? 'is-active' : ''}`}
                            onClick={handleTogglePopup}
                            aria-label={`选择分P (${tracks.length}P)`}
                            title={`选择分P (${tracks.length}P)`}
                        >
                            <Menu size={20} />
                        </button>
                        <AnimatePresence>
                            {showPartsPopup && (
                                <LatticeBilibiliPartsPopup
                                    title={videoTitle}
                                    tracks={tracks}
                                    currentCid={currentCid}
                                    anchorElement={buttonRef.current}
                                    onSelectPart={handleSelectPart}
                                    onClose={() => setShowPartsPopup(false)}
                                />
                            )}
                        </AnimatePresence>
                    </div>
                )}
                <LatticeChromeTime currentTime={canControlCurrent ? currentTime : idleTime} duration={duration} />
                <button type="button" className="lattice-secondary-action" onClick={onOpenPlayer}
                    aria-label={t('home.latticeOpenPlayer')} title={t('home.latticeOpenPlayer')}>
                    <ArrowUpRight size={20} />
                </button>
            </div>
            <div className="lattice-progress">
                <ProgressBar
                    currentTime={canControlCurrent ? currentTime : idleTime}
                    duration={duration}
                    onSeek={canControlCurrent ? onSeek : ignoreSeek}
                    primaryColor="var(--lattice-chrome-ink)"
                    secondaryColor="var(--lattice-chrome-ink)"
                    trackColor="color-mix(in srgb, var(--lattice-chrome-ink) 20%, transparent)"
                    disabled={!canControlCurrent}
                    edgeStyle="square"
                />
            </div>
        </div>
    );
}
