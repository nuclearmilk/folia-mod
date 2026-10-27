import { createContext, useContext } from 'react';
import type { SongResult } from '../../../types';

export interface LatticeSongActionsContextValue {
    onPlaySong: (song: SongResult, queue?: SongResult[]) => void;
}

export const LatticeSongActionsContext = createContext<LatticeSongActionsContextValue | null>(null);

export const useLatticeSongActions = () => useContext(LatticeSongActionsContext);
