// src/resolvers/customFieldClient.js

const TR_FIELD_TYPES = {
  1: 'String', 2: 'Integer', 3: 'Text', 4: 'URL',
  5: 'Checkbox', 6: 'Dropdown', 7: 'User', 8: 'Date',
  9: 'Milestone', 10: 'Steps', 12: 'Multi-select', 13: 'Text (BDD)'
};

const SKIP_SYSTEM_FIELDS = [
  'custom_steps', 'custom_expected', 'custom_preconds',
  'custom_steps_separated', 'custom_testrail_bdd_scenario'
];

function trAuthHeader(email, apiKey) {
  return 'Basic ' + Buffer.from(`${email}:${apiKey}`).toString('base64');
}

// Try all 3 URL formats for TestRail
async function trGet(trUrl, endpoint, email, apiKey) {
  const base = trUrl.replace(/\/$/, '');
  const auth = trAuthHeader(email, apiKey);
  const urls = [
    `${base}/index.php?/api/v2/${endpoint}`,
    `${base}/index.php/api/v2/${endpoint}`,
    `${base}/api/v2/${endpoint}`
  ];

  let lastError = '';
  for (const url of urls) {
    try {
      const r = await fetch(url, {
        headers: {
          'Authorization': auth,
          'Content-Type': 'application/json'
        }
      });
      if (r.ok) {
        return await r.json();
      }
      lastError = `HTTP ${r.status}`;
    } catch (e) {
      lastError = e.message;
      continue;
    }
  }
  throw new Error(`TestRail ${endpoint} failed: ${lastError}`);
}

// Single Zephyr GET
async function zGet(zBaseUrl, path, zToken) {
  const url = `${zBaseUrl.replace(/\/$/, '')}/${path}`;
  const r = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${zToken}`,
      'Content-Type': 'application/json'
    }
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Zephyr ${path} failed: HTTP ${r.status} - ${text.substring(0, 200)}`);
  }
  return r.json();
}

// Paginated Zephyr GET
async function zGetAllPages(zBaseUrl, path, zToken) {
  let results = [];
  let startAt = 0;
  const maxResults = 50;

  while (true) {
    const sep = path.includes('?') ? '&' : '?';
    const data = await zGet(zBaseUrl, `${path}${sep}startAt=${startAt}&maxResults=${maxResults}`, zToken);
    const values = data.values || [];
    results = results.concat(values);
    if (data.isLast !== false || values.length < maxResults) break;
    startAt += maxResults;
  }
  return results;
}

export async function fetchMappingData({ trUrl, trEmail, trToken, zToken, zBaseUrl, zProjectKey }) {
  const errors = [];
  let trStatuses = [];
  let trPriorities = [];
  let trCustomFields = [];
  let zStatuses = [];
  let zPriorities = [];

  // TestRail statuses
  try {
    const raw = await trGet(trUrl, 'get_statuses', trEmail, trToken);
    const list = Array.isArray(raw) ? raw : (raw.statuses || []);
    trStatuses = list.map(s => ({
      id: s.id,
      name: s.name,
      label: s.label || s.name,
      isSystem: s.is_system,
      isUntested: s.is_untested
    }));
  } catch (e) {
    errors.push(`TestRail statuses: ${e.message}`);
  }

  // TestRail priorities
  try {
    const raw = await trGet(trUrl, 'get_priorities', trEmail, trToken);
    const list = Array.isArray(raw) ? raw : (raw.priorities || []);
    trPriorities = list.map(p => ({
      id: p.id,
      name: p.name,
      shortName: p.short_name,
      isDefault: p.is_default
    }));
  } catch (e) {
    errors.push(`TestRail priorities: ${e.message}`);
  }

  // TestRail custom fields
  try {
    const raw = await trGet(trUrl, 'get_case_fields', trEmail, trToken);
    const list = Array.isArray(raw) ? raw : (raw.fields || []);
    trCustomFields = list
      .filter(f => f.is_active && !SKIP_SYSTEM_FIELDS.includes(f.system_name))
      .map(f => {
        let options = [];
        if ((f.type_id === 6 || f.type_id === 12) && f.configs && f.configs[0]) {
          const items = f.configs[0].options && f.configs[0].options.items;
          if (items) {
            options = items.split('\n')
              .filter(line => line.trim())
              .map(line => {
                const parts = line.split(',');
                return {
                  id: parts[0].trim(),
                  label: parts.slice(1).join(',').trim()
                };
              });
          }
        }
        return {
          id: f.id,
          name: f.name,
          systemName: f.system_name,
          label: f.label || f.name,
          typeId: f.type_id,
          typeName: TR_FIELD_TYPES[f.type_id] || `Type ${f.type_id}`,
          isRequired: !!(f.configs && f.configs[0] && f.configs[0].options && f.configs[0].options.is_required),
          options
        };
      });
  } catch (e) {
    errors.push(`TestRail custom fields: ${e.message}`);
  }

  // Zephyr statuses
  try {
    const values = await zGetAllPages(zBaseUrl, `statuses?projectKey=${zProjectKey}`, zToken);
    const seen = new Set();
    zStatuses = values
      .filter(s => !s.archived)
      .filter(s => {
        if (seen.has(s.name)) return false;
        seen.add(s.name);
        return true;
      })
      .map(s => ({ id: s.id, name: s.name }));
  } catch (e) {
    errors.push(`Zephyr statuses: ${e.message}`);
  }

  // Zephyr priorities
  try {
    const values = await zGetAllPages(zBaseUrl, `priorities?projectKey=${zProjectKey}`, zToken);
    zPriorities = values.map(p => ({ id: p.id, name: p.name }));
  } catch (e) {
    errors.push(`Zephyr priorities: ${e.message}`);
  }

  return { ok: errors.length === 0, errors, trStatuses, trPriorities, trCustomFields, zStatuses, zPriorities };
}