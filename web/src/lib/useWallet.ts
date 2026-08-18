'use client';

import { useCallback, useEffect, useState } from 'react';
import { balances, connect, restore, type Balances, type Wallet } from './freighter';

/**
 * The connected wallet, shared by both tabs.
 *
 * Previously each page held its own `wallet` in component state, so moving between them — or
 * refreshing — dropped the connection. That looked like a broken button rather than lost state:
 * Freighter only prompts on first approval, so clicking Connect again resolved silently and the
 * page appeared not to react. Restoring on mount removes the click entirely in the common case.
 *
 * Balances come along because every spending action needs to check them before asking anyone to
 * sign, and re-fetching them at each call site would race the ones already on screen.
 */
export function useWallet() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [funds, setFunds] = useState<Balances | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadBalances = useCallback(async (address: string) => {
    try {
      setFunds(await balances(address));
    } catch {
      setFunds(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    restore()
      .then((found) => {
        if (cancelled || !found) return;
        setWallet(found);
        return loadBalances(found.address);
      })
      .finally(() => {
        if (!cancelled) setRestoring(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadBalances]);

  const open = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const found = await connect();
      setWallet(found);
      await loadBalances(found.address);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setConnecting(false);
    }
  }, [loadBalances]);

  const refresh = useCallback(async () => {
    if (wallet) await loadBalances(wallet.address);
  }, [wallet, loadBalances]);

  return { wallet, funds, connecting, restoring, error, connect: open, refresh };
}
