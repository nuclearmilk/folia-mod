// src/services/onlineMusic/bilibili/bilibiliTransport.ts
// IPC transport connecting renderer to Electron Bilibili bridge.

import { OnlineProviderError } from '../../../types/onlineMusic';

export type BilibiliOperation =
    | 'login_qr_key'
    | 'login_qr_create'
    | 'login_qr_check'
    | 'login_status'
    | 'logout'
    | 'user_playlists'
    | 'playlist_detail'
    | 'video_detail'
    | 'audio'
    | 'search';

export interface BilibiliBridgeResult<T = unknown> {
    ok: boolean;
    data?: T;
    error?: { code: string; message: string };
}

export const BILIBILI_NEEDS_DESKTOP = 'Bilibili requires the desktop app';
export const BILIBILI_BRIDGE_FAILED = 'Bilibili desktop request failed';

export const getBilibiliTransportAvailability = () => ({ configured: true } as const);

export async function requestBilibili<T = unknown>(operation: BilibiliOperation, params: Record<string, unknown> = {}): Promise<T> {
    if (typeof window !== 'undefined' && typeof (window as any).electron?.bilibiliRequest === 'function') {
        let result: BilibiliBridgeResult<T>;
        try {
            result = await (window as any).electron.bilibiliRequest(operation, params);
        } catch (error) {
            throw new OnlineProviderError('network', BILIBILI_BRIDGE_FAILED, 'bilibili', error);
        }

        if (!result.ok) {
            const errCode = (result.error?.code || 'invalid-response') as any;
            throw new OnlineProviderError(errCode, result.error?.message || 'Bilibili operation failed', 'bilibili');
        }

        return result.data as T;
    }

    // Web mode: route through Vite dev server proxy
    try {
        const response = await fetch('/api/bilibili', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ operation, params }),
        });
        const result = (await response.json()) as BilibiliBridgeResult<T>;
        if (!result.ok) {
            const errCode = (result.error?.code || 'invalid-response') as any;
            throw new OnlineProviderError(errCode, result.error?.message || 'Bilibili operation failed', 'bilibili');
        }
        return result.data as T;
    } catch (error) {
        if (error instanceof OnlineProviderError) throw error;
        throw new OnlineProviderError('network', BILIBILI_BRIDGE_FAILED, 'bilibili', error);
    }
}
