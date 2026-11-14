// src/resolvers/mappingStore.js
import { storage, startsWith } from '@forge/api';

// ── Key builders ──────────────────────────────────────────────────────────────
const key = (cloudId, type, trId) => `map_${cloudId}_${type}_${trId}`;
const progressKey = (cloudId) => `progress_${cloudId}`;
const errorKey = (cloudId) => `errors_${cloudId}`;
const contextKey = (cloudId) => `context_${cloudId}`;
const queueKey = (cloudId, name) => `queue_${cloudId}_${name}`;
const reportKey = (cloudId) => `report_${cloudId}`;
const clearProgressKey = (cloudId) => `clearprogress_${cloudId}`;

// ── ID Mappings ───────────────────────────────────────────────────────────────

export async function saveMapping(cloudId, type, trId, zephyrId) {
  await storage.set(key(cloudId, type, trId), zephyrId);
}

export async function getMapping(cloudId, type, trId) {
  return await storage.get(key(cloudId, type, trId));
}

// ── Progress ──────────────────────────────────────────────────────────────────

export async function saveProgress(cloudId, progress) {
  await storage.set(progressKey(cloudId), JSON.stringify(progress));
}

export async function getProgress(cloudId) {
  const raw = await storage.get(progressKey(cloudId));
  return raw ? JSON.parse(raw) : null;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export async function appendErrors(cloudId, newErrors) {
  if (!newErrors || newErrors.length === 0) return;
  const raw = await storage.get(errorKey(cloudId));
  const existing = raw ? JSON.parse(raw) : [];
  const combined = [...existing, ...newErrors].slice(-1000);
  await storage.set(errorKey(cloudId), JSON.stringify(combined));
}

export async function getErrors(cloudId) {
  const raw = await storage.get(errorKey(cloudId));
  return raw ? JSON.parse(raw) : [];
}

// ── Context ───────────────────────────────────────────────────────────────────

export async function saveContext(cloudId, context) {
  await storage.set(contextKey(cloudId), JSON.stringify(context));
}

export async function getContext(cloudId) {
  const raw = await storage.get(contextKey(cloudId));
  return raw ? JSON.parse(raw) : null;
}

// ── Queues ────────────────────────────────────────────────────────────────────

export async function saveQueue(cloudId, name, items) {
  await storage.set(queueKey(cloudId, name), JSON.stringify(items));
}

export async function getQueue(cloudId, name) {
  const raw = await storage.get(queueKey(cloudId, name));
  return raw ? JSON.parse(raw) : null;
}

// ── Migration Report ──────────────────────────────────────────────────────────
// Tracks every single item: created, skipped, or failed

export async function initReport(cloudId) {
  const report = {
    startedAt: new Date().toISOString(),
    completedAt: null,
    dryRun: false,
    summary: {
      cases:      { created: 0, skipped: 0, failed: 0 },
      plans:      { created: 0, skipped: 0, failed: 0 },
      cycles:     { created: 0, skipped: 0, failed: 0 },
      executions: { created: 0, skipped: 0, failed: 0 },
      steps:      { created: 0, failed: 0 },
    },
    failed: [],    // { entity, trId, name, error }
    skipped: [],   // { entity, trId, name, reason }
    created: [],   // { entity, trId, name, zephyrKey }
  };
  await storage.set(reportKey(cloudId), JSON.stringify(report));
  return report;
}

export async function getReport(cloudId) {
  const raw = await storage.get(reportKey(cloudId));
  return raw ? JSON.parse(raw) : null;
}

export async function updateReport(cloudId, updates) {
  const raw = await storage.get(reportKey(cloudId));
  const report = raw ? JSON.parse(raw) : await initReport(cloudId);

  // Update summary counts
  if (updates.summary) {
    for (const [entity, counts] of Object.entries(updates.summary)) {
      if (report.summary[entity]) {
        for (const [key, val] of Object.entries(counts)) {
          report.summary[entity][key] = (report.summary[entity][key] || 0) + val;
        }
      }
    }
  }

  // Append items (keep last 500 of each to avoid storage limits)
  if (updates.failed && updates.failed.length > 0) {
    report.failed = [...report.failed, ...updates.failed].slice(-500);
  }
  if (updates.skipped && updates.skipped.length > 0) {
    report.skipped = [...report.skipped, ...updates.skipped].slice(-500);
  }
  if (updates.created && updates.created.length > 0) {
    report.created = [...report.created, ...updates.created].slice(-500);
  }
  if (updates.completedAt) {
    report.completedAt = updates.completedAt;
  }
  if (updates.dryRun !== undefined) {
    report.dryRun = updates.dryRun;
  }

  await storage.set(reportKey(cloudId), JSON.stringify(report));
  return report;
}

// ── Clear Data (CHUNKED — one batch per invocation, never blocks >25s) ───────
//
// Forge kills any single function invocation after 25 seconds. The old
// implementation deleted every "map_*" key one at a time inside a single
// do/while loop, which times out once there are more than a couple hundred
// keys. This version deletes ONE PAGE per call and remembers where it left
// off in storage itself, so the frontend can call it repeatedly until done.

const KNOWN_KEYS_BATCH_SIZE = 50; // safe parallel-delete batch size

function getKnownKeys(cloudId) {
  return [
    progressKey(cloudId),
    errorKey(cloudId),
    contextKey(cloudId),
    reportKey(cloudId),
    queueKey(cloudId, 'cases'),
    queueKey(cloudId, 'plans'),
    queueKey(cloudId, 'cycles'),
    queueKey(cloudId, 'executions'),
    queueKey(cloudId, 'suites'),
    queueKey(cloudId, 'runs_for_exec'),
    queueKey(cloudId, 'folders'),
  ];
}

async function deleteKeysInParallel(keys) {
  // Delete in small batches so we don't fire hundreds of concurrent
  // requests at once (which can itself cause Forge proxy issues).
  for (let i = 0; i < keys.length; i += KNOWN_KEYS_BATCH_SIZE) {
    const batch = keys.slice(i, i + KNOWN_KEYS_BATCH_SIZE);
    await Promise.all(batch.map(k => storage.delete(k).catch(() => {})));
  }
}

// Call this once to begin a clear operation. Sets up progress tracking.
export async function startClear(cloudId) {
  const clearProgress = { phase: 'known', cursor: null, deletedCount: 0 };
  await storage.set(clearProgressKey(cloudId), JSON.stringify(clearProgress));
  return clearProgress;
}

// Call this repeatedly (once per invocation) until it returns done: true.
export async function clearMigrationDataStep(cloudId) {
  const raw = await storage.get(clearProgressKey(cloudId));
  let clearProgress = raw ? JSON.parse(raw) : await startClear(cloudId);

  // ── Phase 1: delete the small set of known singleton/queue keys ──────────
  if (clearProgress.phase === 'known') {
    const knownKeys = getKnownKeys(cloudId);
    await deleteKeysInParallel(knownKeys);
    clearProgress.deletedCount += knownKeys.length;
    clearProgress.phase = 'mapping';
    clearProgress.cursor = null;
    await storage.set(clearProgressKey(cloudId), JSON.stringify(clearProgress));
    return { done: false, deletedCount: clearProgress.deletedCount, phase: clearProgress.phase };
  }

  // ── Phase 2: delete "map_*" keys, one page per call ──────────────────────
  if (clearProgress.phase === 'mapping') {
    try {
      const result = await storage.query()
        .where('key', startsWith(`map_${cloudId}_`))
        .getMany({ cursor: clearProgress.cursor || undefined });

      const items = result.results || [];
      if (items.length > 0) {
        await deleteKeysInParallel(items.map(item => item.key));
        clearProgress.deletedCount += items.length;
      }

      clearProgress.cursor = result.nextCursor || null;

      if (!clearProgress.cursor) {
        clearProgress.phase = 'done';
      }

      await storage.set(clearProgressKey(cloudId), JSON.stringify(clearProgress));
      return { done: clearProgress.phase === 'done', deletedCount: clearProgress.deletedCount, phase: clearProgress.phase };
    } catch (e) {
      console.log(`[CLEAR] mapping cleanup error: ${e.message}`);
      clearProgress.phase = 'done';
      await storage.set(clearProgressKey(cloudId), JSON.stringify(clearProgress));
      return { done: true, deletedCount: clearProgress.deletedCount, phase: 'done', error: e.message };
    }
  }

  // ── Phase 3: done — clean up our own tracking key ────────────────────────
  await storage.delete(clearProgressKey(cloudId)).catch(() => {});
  console.log(`[CLEAR] All migration data cleared for ${cloudId} (${clearProgress.deletedCount} keys)`);
  return { done: true, deletedCount: clearProgress.deletedCount, phase: 'done' };
}

// ── Get storage summary (show user what's stored before clearing) ─────────────

export async function getStorageSummary(cloudId) {
  const progress = await getProgress(cloudId);
  const report = await getReport(cloudId);
  const context = await getContext(cloudId);

  return {
    hasData: !!(progress || report || context),
    progress,
    report,
    lastRun: report ? {
      startedAt: report.startedAt,
      completedAt: report.completedAt,
      dryRun: report.dryRun,
      summary: report.summary,
    } : null,
    projectKey: context ? context.zProjectKey : null,
    trProjectId: context ? context.trProjectId : null,
  };
}