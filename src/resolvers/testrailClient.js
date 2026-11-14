// src/resolvers/testrailClient.js
// READ-ONLY — only GET requests are ever made to TestRail.
// POST, PUT, DELETE are intentionally absent and will never be added here.

import { fetch } from '@forge/api';

function authHeader(email, apiKey) {
  const encoded = Buffer.from(`${email}:${apiKey}`).toString('base64');
  return `Basic ${encoded}`;
}

// ── Safe GET helper ───────────────────────────────────────────────────────────
// TestRail Cloud URL format: base/index.php?/api/v2/path
// Every additional parameter uses & (not ? — the ? is already in index.php?/)
async function trGet(baseUrl, path, email, apiKey) {
  const url = `${baseUrl}/index.php?/api/v2${path}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': authHeader(email, apiKey),
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`TestRail GET ${path} failed ${res.status}: ${text.substring(0, 300)}`);
  }
  return res.json();
}

// ── Paginated GET ─────────────────────────────────────────────────────────────
async function trGetAll(baseUrl, path, email, apiKey, resultKey) {
  const limit = 250;
  let offset = 0;
  let all = [];

  while (true) {
    const pagedPath = `${path}&limit=${limit}&offset=${offset}`;
    const data = await trGet(baseUrl, pagedPath, email, apiKey);
    const items = data[resultKey] ?? data;
    if (!Array.isArray(items) || items.length === 0) break;
    all = all.concat(items);
    if (items.length < limit) break;
    offset += limit;
  }

  return all;
}

// ── Public read-only API functions ────────────────────────────────────────────

export async function getProjects(baseUrl, email, apiKey) {
  return trGetAll(baseUrl, '/get_projects', email, apiKey, 'projects');
}

export async function getSuites(baseUrl, email, apiKey, projectId) {
  try {
    const data = await trGet(baseUrl, `/get_suites/${projectId}`, email, apiKey);
    const suites = Array.isArray(data) ? data : (data ? [data] : []);
    const validSuites = suites.filter(s => s && s.id !== undefined && s.id !== null);
    if (validSuites.length > 0) return validSuites;
    return [{ id: null, name: 'Default Suite' }];
  } catch (e) {
    return [{ id: null, name: 'Default Suite' }];
  }
}

export async function getCases(baseUrl, email, apiKey, projectId, suiteId) {
  const validSuiteId = (suiteId !== undefined && suiteId !== null &&
    suiteId !== 'undefined' && suiteId !== '')
    ? suiteId : null;

  // include_all=1 ensures TestRail returns ALL custom fields including
  // custom_steps_separated, custom_steps, custom_expected for all templates
  const path = validSuiteId
    ? `/get_cases/${projectId}&suite_id=${validSuiteId}&include_all=1`
    : `/get_cases/${projectId}&include_all=1`;

  return trGetAll(baseUrl, path, email, apiKey, 'cases');
}

export async function getPlans(baseUrl, email, apiKey, projectId) {
  return trGetAll(baseUrl, `/get_plans/${projectId}`, email, apiKey, 'plans');
}

export async function getPlan(baseUrl, email, apiKey, planId) {
  return trGet(baseUrl, `/get_plan/${planId}`, email, apiKey);
}

export async function getRuns(baseUrl, email, apiKey, projectId) {
  return trGetAll(baseUrl, `/get_runs/${projectId}`, email, apiKey, 'runs');
}

export async function getResultsForRun(baseUrl, email, apiKey, runId) {
  // include_all=1 fetches results for all statuses including untested
  return trGetAll(
    baseUrl,
    `/get_results_for_run/${runId}&include_all=1`,
    email, apiKey, 'results'
  );
}

export async function getAttachmentsForCase(baseUrl, email, apiKey, caseId) {
  try {
    return await trGetAll(
      baseUrl,
      `/get_attachments_for_case/${caseId}`,
      email, apiKey, 'attachments'
    );
  } catch {
    return [];
  }
}

export async function getConfigs(baseUrl, email, apiKey, projectId) {
  try {
    const data = await trGet(baseUrl, `/get_configs/${projectId}`, email, apiKey);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

export async function getMilestones(baseUrl, email, apiKey, projectId) {
  try {
    return await trGetAll(
      baseUrl,
      `/get_milestones/${projectId}`,
      email, apiKey, 'milestones'
    );
  } catch {
    return [];
  }
}

export async function getUsers(baseUrl, email, apiKey) {
  try {
    return await trGetAll(baseUrl, '/get_users', email, apiKey, 'users');
  } catch {
    return [];
  }
}

export async function getSections(baseUrl, email, apiKey, projectId, suiteId) {
  const path = suiteId
    ? `/get_sections/${projectId}&suite_id=${suiteId}`
    : `/get_sections/${projectId}`;
  return trGetAll(baseUrl, path, email, apiKey, 'sections');
}

// Fetch users for a specific project (needed for user mapping)
export async function getProjectUsers(baseUrl, email, apiKey, projectId) {
  try {
    return await trGetAll(
      baseUrl,
      `/get_users/${projectId}`,
      email, apiKey, 'users'
    );
  } catch {
    // Fall back to global users if project-scoped fails
    return getUsers(baseUrl, email, apiKey);
  }
}