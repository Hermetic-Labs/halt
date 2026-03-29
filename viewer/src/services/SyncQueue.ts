/**
 * Offline Sync Queue
 * Stores failed API mutations (POST/PUT/DELETE) when offline,
 * replays them in order when connectivity returns.
 */

interface QueuedRequest {
    id: string;
    url: string;
    method: string;
    body?: string;
    headers?: Record<string, string>;
    timestamp: number;
    retries: number;
}

const STORAGE_KEY = 'eve-sync-queue';
const MAX_RETRIES = 5;

function getQueue(): QueuedRequest[] {
    try {
        return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
        return [];
    }
}

function saveQueue(queue: QueuedRequest[]) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(queue));
}

/** Add a failed request to the sync queue */
export function enqueue(url: string, method: string, body?: string, headers?: Record<string, string>) {
    const queue = getQueue();
    queue.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url,
        method,
        body,
        headers,
        timestamp: Date.now(),
        retries: 0,
    });
    saveQueue(queue);
    console.log(`[SyncQueue] Enqueued ${method} ${url} (${queue.length} pending)`);
}

/** How many requests are waiting */
export function pendingCount(): number {
    return getQueue().length;
}

/** Attempt to replay all queued requests */
export async function flush(): Promise<{ success: number; failed: number }> {
    const queue = getQueue();
    if (queue.length === 0) return { success: 0, failed: 0 };

    console.log(`[SyncQueue] Flushing ${queue.length} queued requests...`);
    let success = 0;
    let failed = 0;
    const remaining: QueuedRequest[] = [];

    for (const req of queue) {
        try {
            const res = await fetch(req.url, {
                method: req.method,
                headers: req.headers,
                body: req.body,
            });
            if (res.ok) {
                success++;
                console.log(`[SyncQueue] Replayed ${req.method} ${req.url}`);
            } else {
                req.retries++;
                if (req.retries < MAX_RETRIES) remaining.push(req);
                else failed++;
            }
        } catch {
            // Still offline
            req.retries++;
            if (req.retries < MAX_RETRIES) remaining.push(req);
            else failed++;
        }
    }

    saveQueue(remaining);
    console.log(`[SyncQueue] Done: ${success} replayed, ${remaining.length} still pending, ${failed} dropped`);
    return { success, failed };
}

/** Auto-flush when coming back online */
export function startAutoSync() {
    window.addEventListener('online', () => {
        console.log('[SyncQueue] Back online — flushing queue...');
        flush();
    });

    // Also try flushing periodically (handles reconnecting to mesh without full internet)
    setInterval(() => {
        if (navigator.onLine && pendingCount() > 0) {
            flush();
        }
    }, 30000);
}
