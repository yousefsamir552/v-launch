import { useEffect, useRef } from 'react';

export interface NavHistoryState {
  __erpNav: true;
  depth: number;
  tab: string;
  modelId?: string;
}

interface ModalHistoryState {
  __erpModal: true;
  __erpModalId: string;
  depth: number;
  tab: string;
  modelId?: string;
}

interface ModalStackEntry {
  id: string;
  onClose: () => void;
}

type NavPopListener = (state: NavHistoryState | null) => void;

let modalSeq = 0;
let navDepth = 0;
let currentTabSnapshot = 'dashboard';
let currentModelIdSnapshot = '';
let ignoreNextPopCount = 0;
let listenerAttached = false;

const modalStack: ModalStackEntry[] = [];
const closedByPopIds = new Set<string>();
const navListeners = new Set<NavPopListener>();

const canUseHistory = (): boolean =>
  typeof window !== 'undefined' && typeof window.history !== 'undefined';

const handleGlobalPopState = (event: PopStateEvent) => {
  if (ignoreNextPopCount > 0) {
    ignoreNextPopCount -= 1;
    return;
  }

  // 1. Always close the topmost open modal/drawer first before stepping back a view.
  if (modalStack.length > 0) {
    const top = modalStack.pop()!;
    closedByPopIds.add(top.id);
    try {
      top.onClose();
    } catch {
      // ignore consumer errors so history remains responsive
    }
    return;
  }

  // 2. Otherwise step back to the previous in-app view/section without full page reload.
  const raw = event.state as Partial<NavHistoryState & ModalHistoryState> | null;
  if (raw && raw.__erpNav && typeof raw.tab === 'string') {
    navDepth = typeof raw.depth === 'number' ? raw.depth : 0;
    currentTabSnapshot = raw.tab;
    currentModelIdSnapshot = raw.modelId || '';
    const navState: NavHistoryState = {
      __erpNav: true,
      depth: navDepth,
      tab: raw.tab,
      modelId: raw.modelId || ''
    };
    navListeners.forEach((fn) => fn(navState));
    return;
  }

  navListeners.forEach((fn) => fn(null));
};

const ensurePopListener = () => {
  if (!canUseHistory() || listenerAttached) return;
  window.addEventListener('popstate', handleGlobalPopState);
  listenerAttached = true;
};

/** Initializes or replaces the root history entry (depth = 0). */
export const initRootNavHistory = (tab: string, modelId = ''): void => {
  if (!canUseHistory()) return;
  ensurePopListener();
  navDepth = 0;
  currentTabSnapshot = tab;
  currentModelIdSnapshot = modelId;
  const rootState: NavHistoryState = {
    __erpNav: true,
    depth: 0,
    tab,
    modelId
  };
  try {
    window.history.replaceState(rootState, '');
  } catch {
    // ignore restricted history environments
  }
};

/** Pushes a new in-app navigation view/sub-view onto browser history. */
export const pushNavHistory = (tab: string, modelId = ''): void => {
  if (!canUseHistory()) return;
  ensurePopListener();
  if (tab === currentTabSnapshot && (modelId || '') === currentModelIdSnapshot) {
    return;
  }
  navDepth += 1;
  currentTabSnapshot = tab;
  currentModelIdSnapshot = modelId || '';
  const state: NavHistoryState = {
    __erpNav: true,
    depth: navDepth,
    tab,
    modelId: modelId || ''
  };
  try {
    window.history.pushState(state, '');
  } catch {
    // ignore
  }
};

/** Syncs internal snapshot without pushing a new entry (e.g. on permission fallback). */
export const replaceNavHistory = (tab: string, modelId = ''): void => {
  if (!canUseHistory()) return;
  ensurePopListener();
  currentTabSnapshot = tab;
  currentModelIdSnapshot = modelId || '';
  const state: NavHistoryState = {
    __erpNav: true,
    depth: navDepth,
    tab,
    modelId: modelId || ''
  };
  try {
    window.history.replaceState(state, '');
  } catch {
    // ignore
  }
};

/**
 * Steps back one history entry when we have in-app history depth, keeping browser
 * history synchronized with in-app "العودة" buttons; otherwise executes fallback.
 */
export const stepBackOrNavigate = (fallback: () => void): void => {
  if (canUseHistory() && navDepth > 0 && modalStack.length === 0) {
    window.history.back();
    return;
  }
  fallback();
};

/** Subscribes App-level router to popstate navigation changes. */
export const subscribeNavPop = (listener: NavPopListener): (() => void) => {
  ensurePopListener();
  navListeners.add(listener);
  return () => {
    navListeners.delete(listener);
  };
};

/**
 * Registers an open modal / drawer / lightbox with the browser Back button stack.
 * - Opening pushes a lightweight history entry.
 * - Pressing hardware/browser Back closes ONLY the topmost modal.
 * - Closing via UI buttons pops the matching history entry cleanly without changing tabs.
 */
export const useModalBackHandler = (isOpen: boolean, onClose: () => void): void => {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen || !canUseHistory()) return;
    ensurePopListener();

    modalSeq += 1;
    const modalId = `erp-modal-${modalSeq}`;
    const entry: ModalStackEntry = {
      id: modalId,
      onClose: () => onCloseRef.current()
    };
    modalStack.push(entry);

    const state: ModalHistoryState = {
      __erpModal: true,
      __erpModalId: modalId,
      depth: navDepth,
      tab: currentTabSnapshot,
      modelId: currentModelIdSnapshot
    };
    try {
      window.history.pushState(state, '');
    } catch {
      // ignore
    }

    return () => {
      const idx = modalStack.findIndex((item) => item.id === modalId);
      if (idx !== -1) {
        modalStack.splice(idx, 1);
      }

      if (closedByPopIds.has(modalId)) {
        closedByPopIds.delete(modalId);
        return;
      }

      // Modal closed via UI (X / Cancel / Save): pop its history entry only if it is still top-of-history.
      const currentState = window.history.state as Partial<ModalHistoryState> | null;
      if (currentState && currentState.__erpModal && currentState.__erpModalId === modalId) {
        ignoreNextPopCount += 1;
        window.history.back();
      }
    };
  }, [isOpen]);
};
