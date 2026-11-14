// src/index.js — Forge backend resolver (ES Module style)
import Resolver from '@forge/resolver';
import { fetchMappingData } from './resolvers/customFieldClient.js';
import { initMigration, runMigrationStep } from './resolvers/migrationEngine.js';
import {
  getProgress,
  getErrors,
  getReport,
  getStorageSummary,
  clearMigrationDataStep,
  startClear,
} from './resolvers/mappingStore.js';

const resolver = new Resolver();

function getZephyrBaseUrl(zBaseUrl) {
  if (zBaseUrl && zBaseUrl.trim()) return zBaseUrl.trim().replace(/\/$/, '');
  return 'https://prod-play.zephyr4jiracloud.com/connect/v2';
}

// ── Test TestRail Connection ──────────────────────────────────────────────────
resolver.define('testTestrailConnection', async ({ payload }) => {
  const { trUrl, trEmail, trToken } = payload;
  const base = trUrl.replace(/\/$/, '');
  const auth = 'Basic ' + Buffer.from(`${trEmail}:${trToken}`).toString('base64');
  const headers = { 'Authorization': auth, 'Content-Type': 'application/json' };
  const urls = [
    `${base}/index.php?/api/v2/get_projects`,
    `${base}/index.php/api/v2/get_projects`,
    `${base}/api/v2/get_projects`
  ];
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data = await res.json();
        const projects = Array.isArray(data) ? data : (data.projects || []);
        return { ok: true, projects: projects.map(p => ({ id: p.id, name: p.name })) };
      }
    } catch (e) { continue; }
  }
  return { ok: false, error: 'Could not connect - check URL and credentials' };
});

// ── Test Zephyr Connection ────────────────────────────────────────────────────
resolver.define('testZephyrConnection', async ({ payload }) => {
  const { zToken, zBaseUrl } = payload;
  const baseUrl = getZephyrBaseUrl(zBaseUrl);
  try {
    const res = await fetch(`${baseUrl}/projects`, {
      headers: { 'Authorization': `Bearer ${zToken}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      const text = await res.text();
      return { ok: false, error: `HTTP ${res.status}: ${text.substring(0, 200)}` };
    }
    const data = await res.json();
    const projects = data.values || (Array.isArray(data) ? data : []);
    return {
      ok: true,
      projects: projects.map(p => ({
        id: p.id,
        key: p.key || p.id,
        name: p.name || p.key || String(p.id)
      }))
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ── Fetch Mapping Data ────────────────────────────────────────────────────────
resolver.define('fetchMappingData', async ({ payload }) => {
  const { trUrl, trEmail, trToken, zToken, zBaseUrl, zProjectKey } = payload;
  try {
    const result = await fetchMappingData({
      trUrl, trEmail, trToken, zToken,
      zBaseUrl: getZephyrBaseUrl(zBaseUrl),
      zProjectKey
    });
    return result;
  } catch (e) {
    return {
      ok: false, errors: [e.message],
      trStatuses: [], trPriorities: [],
      trCustomFields: [], zStatuses: [], zPriorities: []
    };
  }
});

// ── Start Migration ───────────────────────────────────────────────────────────
resolver.define('startMigration', async ({ payload, context }) => {
  try {
    const result = await initMigration({
      ...payload,
      cloudId: context.cloudId,
      zBaseUrl: getZephyrBaseUrl(payload.zBaseUrl)
    });
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Run Migration Step ────────────────────────────────────────────────────────
resolver.define('runMigrationStep', async ({ context }) => {
  try {
    const result = await runMigrationStep(context.cloudId);
    return result;
  } catch (e) {
    return { success: false, error: e.message };
  }
});

// ── Get Progress ──────────────────────────────────────────────────────────────
resolver.define('getProgress', async ({ context }) => {
  try {
    const progress = await getProgress(context.cloudId);
    return { progress };
  } catch (e) {
    return { progress: null };
  }
});

// ── Get Errors ────────────────────────────────────────────────────────────────
resolver.define('getErrors', async ({ context }) => {
  try {
    const errors = await getErrors(context.cloudId);
    return { errors };
  } catch (e) {
    return { errors: [] };
  }
});

// ── Get Migration Report ──────────────────────────────────────────────────────
resolver.define('getMigrationReport', async ({ context }) => {
  try {
    const report = await getReport(context.cloudId);
    return { report };
  } catch (e) {
    return { report: null };
  }
});

// ── Get Storage Summary (before clear) ───────────────────────────────────────
resolver.define('getStorageSummary', async ({ context }) => {
  try {
    const summary = await getStorageSummary(context.cloudId);
    return { summary };
  } catch (e) {
    return { summary: null };
  }
});

// ── Clear Migration Data (CHUNKED — call repeatedly until done: true) ────────
// The frontend calls this once with { start: true } to reset the clear
// progress tracker, then calls it again with no payload repeatedly until
// the response has done: true. Each call only deletes one small batch,
// so no single invocation can exceed Forge's 25-second limit.
resolver.define('clearMigrationData', async ({ context, payload }) => {
  try {
    if (payload && payload.start) {
      await startClear(context.cloudId);
    }
    const result = await clearMigrationDataStep(context.cloudId);
    return { success: true, ...result };
  } catch (e) {
    return { success: false, error: e.message };
  }
});

export const handler = resolver.getDefinitions();