import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const readAccountMock = vi.hoisted(() => vi.fn(async () => 'read'));

vi.mock('@/services/onlineMusic/omni', () => ({
    omni: {
        readAccount: readAccountMock,
        getProviderSummaries: () => [],
        getProviderLabel: (id: string) => id,
        subscribeProviders: () => () => {},
        invalidateActiveRequests: vi.fn(),
        canRunLoginSelfCheck: () => false,
        checksAfterLogin: () => false,
        hasSetup: () => false,
    },
}));

import { readProviderAccount, SWITCH_FRESH_MS } from '@/library/core/account/providerAccountDeps.service';
import { useOnlineProviderAccountStore } from '@/stores/useOnlineProviderAccountStore';

describe('readProviderAccount switch cooldown', () => {
    const providerId = 'netease';
    const user = { id: 'u1', nickname: 'User' };

    beforeEach(() => {
        vi.clearAllMocks();
        useOnlineProviderAccountStore.setState({ accounts: {} });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        useOnlineProviderAccountStore.setState({ accounts: {} });
    });

    it('skips omni.readAccount on switch when the account was refreshed within SWITCH_FRESH_MS', async () => {
        const now = 1_760_000_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now + SWITCH_FRESH_MS - 1_000);
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            status: 'authenticated',
            user,
            freshness: 'fresh',
            lastUpdatedAt: now,
        });

        await expect(readProviderAccount(providerId, 'switch')).resolves.toBe(true);
        expect(readAccountMock).not.toHaveBeenCalled();

        // Explicit sync still bypasses the switch cooldown.
        await expect(readProviderAccount(providerId, 'sync')).resolves.toBe(true);
        expect(readAccountMock).toHaveBeenCalledWith(providerId, 'sync');
    });

    it('refreshes on switch once SWITCH_FRESH_MS has elapsed', async () => {
        const now = 1_760_000_000_000;
        vi.spyOn(Date, 'now').mockReturnValue(now + SWITCH_FRESH_MS);
        useOnlineProviderAccountStore.getState().updateAccount(providerId, {
            status: 'authenticated',
            user,
            freshness: 'fresh',
            lastUpdatedAt: now,
        });

        await expect(readProviderAccount(providerId, 'switch')).resolves.toBe(true);
        expect(readAccountMock).toHaveBeenCalledWith(providerId, 'switch');
    });
});
