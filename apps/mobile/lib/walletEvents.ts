/**
 * Tiny in-process event bus. Screens each own a `useAccountSnapshot()` instance, so a change
 * made on one screen (switching accounts, adding a token, a network edit) is broadcast here and
 * every live instance reloads.
 */
type Listener = () => void;

const listeners = new Set<Listener>();

export function onWalletChange(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function emitWalletChange(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A failing listener must not stop the others.
    }
  }
}
