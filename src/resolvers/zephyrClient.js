// src/resolvers/zephyrClient.js

function zHeaders(zToken) {
  return {
    'Authorization': `Bearer ${zToken}`,
    'Content-Type': 'application/json'
  };
}

async function zRequest(method, baseUrl, path, zToken, body, timeoutMs = 12000) {
  const url = `${baseUrl.replace(/\/$/, '')}/${path}`;
  const opts = { method, headers: zHeaders(zToken) };
  if (body) opts.body = JSON.stringify(body);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  opts.signal = controller.signal;

  let res;
  try {
    res = await fetch(url, opts);
  } catch (e) {
    if (e.name === 'AbortError') {
      throw new Error(`Zephyr ${method} ${path} timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Zephyr ${method} ${path} failed: HTTP ${res.status} - ${text.substring(0, 300)}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function zGetAll(baseUrl, path, zToken) {
  let results = [];
  let startAt = 0;
  const maxResults = 50;
  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await zRequest('GET', baseUrl, `${path}${sep}startAt=${startAt}&maxResults=${maxResults}`, zToken);
    results = results.concat(data.values || []);
    if (data.isLast !== false) break;
    startAt += maxResults;
    if (results.length >= (data.total || 0)) break;
  }
  return results;
}

export async function getZephyrProjects(baseUrl, zToken) {
  return zGetAll(baseUrl, 'projects', zToken);
}

export async function getStatuses(baseUrl, zToken, projectKey) {
  return zGetAll(baseUrl, `statuses?projectKey=${projectKey}`, zToken);
}

export async function getPriorities(baseUrl, zToken, projectKey) {
  return zGetAll(baseUrl, `priorities?projectKey=${projectKey}`, zToken);
}

// ── Create a test case ────────────────────────────────────────────────────────
// Signature: (zToken, zBaseUrl, zProjectKey, payload)
export async function createTestCase(zToken, zBaseUrl, zProjectKey, payload) {
  const body = {
  projectKey: zProjectKey,
  name: (payload.name || 'Untitled').substring(0, 255),
  objective: payload.objective || undefined,
  precondition: payload.precondition || undefined,
  priorityName: payload.priorityName || 'Normal',
  statusName: 'Draft',
  estimatedTime: payload.estimatedTime || undefined,
  labels: payload.labels || [],
  customFields: payload.customFields && Object.keys(payload.customFields).length > 0
    ? payload.customFields : undefined,
  testScript: payload.testScript || undefined,
  folderId: payload.folderId || undefined,
};

  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
  return zRequest('POST', zBaseUrl, 'testcases', zToken, body);
}

// ── Create a test plan ────────────────────────────────────────────────────────
// Signature: (zToken, zBaseUrl, zProjectKey, payload)
export async function createTestPlan(zToken, zBaseUrl, zProjectKey, payload) {
  const body = {
    projectKey: zProjectKey,
    name: (payload.name || 'Untitled').substring(0, 255),
    objective: payload.objective || undefined,
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
  return zRequest('POST', zBaseUrl, 'testplans', zToken, body);
}

// ── Create a test cycle ───────────────────────────────────────────────────────
// Signature: (zToken, zBaseUrl, zProjectKey, payload)
export async function createTestCycle(zToken, zBaseUrl, zProjectKey, payload) {
  const body = {
    projectKey: zProjectKey,
    name: (payload.name || 'Untitled').substring(0, 255),
    description: payload.description || undefined,
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
  return zRequest('POST', zBaseUrl, 'testcycles', zToken, body);
}

// ── Create a test execution ───────────────────────────────────────────────────
// Signature: (zToken, zBaseUrl, cycleKey, payload)
export async function createTestExecution(zToken, zBaseUrl, zProjectKey, cycleKey, payload) {
  const body = {
    projectKey: zProjectKey,
    testCycleKey: cycleKey,
    testCaseKey: payload.testCaseKey,
    statusName: payload.statusName || 'Not Executed',
    comment: payload.comment || undefined,
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
  return zRequest('POST', zBaseUrl, 'testexecutions', zToken, body);
}

export function parseElapsed(elapsed) {
  if (!elapsed) return undefined;
  let ms = 0;
  const hours = elapsed.match(/(\d+)h/);
  const mins = elapsed.match(/(\d+)m/);
  const secs = elapsed.match(/(\d+)s/);
  if (hours) ms += parseInt(hours[1]) * 3600000;
  if (mins) ms += parseInt(mins[1]) * 60000;
  if (secs) ms += parseInt(secs[1]) * 1000;
  return ms || undefined;
}

export async function createFolder(zToken, zBaseUrl, zProjectKey, name, parentId) {
  const body = {
    projectKey: zProjectKey,
    name: name.substring(0, 255),
    parentId: parentId || undefined,
  };
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
  return zRequest('POST', zBaseUrl, 'folders?projectKey=' + zProjectKey, zToken, body);
}


