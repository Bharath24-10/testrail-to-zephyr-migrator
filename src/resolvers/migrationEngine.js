// src/resolvers/migrationEngine.js
import * as TR from './testrailClient.js';
import * as ZS from './zephyrClient.js';
import {
  saveMapping, getMapping,
  saveProgress, getProgress,
  appendErrors,
  saveQueue, getQueue,
  saveContext, getContext,
  initReport, updateReport,
} from './mappingStore.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapStatus(trStatusId, trStatuses, statusMap) {
  const trStatus = (trStatuses || []).find(s => String(s.id) === String(trStatusId));
  const label = trStatus ? trStatus.label : null;
  if (label && statusMap && statusMap[label]) return statusMap[label];
  // Fallback for system statuses
  const fallback = { 1: 'Pass', 2: 'Blocked', 3: 'Not Executed', 4: 'In Progress', 5: 'Fail' };
  return fallback[trStatusId] ?? 'Not Executed';
}

function mapPriority(trPriorityName, priorityMap) {
  if (priorityMap && trPriorityName && priorityMap[trPriorityName]) {
    return priorityMap[trPriorityName];
  }
  return 'Normal';
}

// Map TestRail user email or ID to Zephyr account ID using userMap
// userMap: { "email@company.com": "zephyr-account-id", ... }
function mapUser(trUserId, trUsers, userMap) {
  if (!userMap || !trUserId) return undefined;

  // trUserId is a numeric ID — look up email first
  const trUser = (trUsers || []).find(u => String(u.id) === String(trUserId));
  if (!trUser) return undefined;

  // Try matching by email
  const email = trUser.email;
  if (email && userMap[email]) return userMap[email];

  // Try matching by name
  const name = trUser.name;
  if (name && userMap[name]) return userMap[name];

  return undefined;
}

function resolveOptionLabel(fieldSystemName, optionId, field, optionMap) {
  if (optionMap && optionMap[fieldSystemName] && optionMap[fieldSystemName][String(optionId)]) {
    return optionMap[fieldSystemName][String(optionId)];
  }
  const opt = (field.options || []).find(o => String(o.id) === String(optionId));
  return opt ? opt.label : null;
}

function buildCustomFields(trCase, trCustomFields, mappings) {
  const { fieldMap, optionMap } = mappings || {};
  const customFields = {};
  const fieldErrors = [];

  for (const field of (trCustomFields || [])) {
    const zFieldName = ((fieldMap && fieldMap[field.systemName]) || '').trim();
    if (!zFieldName) continue;

    const rawValue = trCase[field.systemName];
    if (rawValue === null || rawValue === undefined || rawValue === '') continue;

    try {
      if (field.typeId === 6) {
        // Dropdown — map option ID to label
        const label = resolveOptionLabel(field.systemName, rawValue, field, optionMap);
        if (label) customFields[zFieldName] = label;
        else fieldErrors.push(`${field.label}: option ID ${rawValue} not found`);
      } else if (field.typeId === 12) {
        // Multi-select — map each option ID to label
        const ids = Array.isArray(rawValue)
          ? rawValue
          : String(rawValue).split(',').map(s => s.trim()).filter(Boolean);
        const labels = ids
          .map(id => resolveOptionLabel(field.systemName, id, field, optionMap))
          .filter(Boolean);
        if (labels.length > 0) customFields[zFieldName] = labels.join(', ');
        else fieldErrors.push(`${field.label}: could not resolve IDs ${rawValue}`);
      } else if (field.typeId === 5) {
        // Checkbox — convert to boolean
        customFields[zFieldName] = Boolean(
          rawValue && rawValue !== '0' && rawValue !== 0
        );
      } else if (field.typeId === 7 || field.typeId === 9) {
        // User/Milestone — skip in custom fields, handled via userMap separately
      } else if (field.typeId === 10 || field.typeId === 13) {
        // Steps/BDD — handled by buildTestScript separately
      } else {
        // String, Integer, Text, URL, Date — pass as string
        customFields[zFieldName] = String(rawValue);
      }
    } catch (e) {
      fieldErrors.push(`${field.label}: ${e.message}`);
    }
  }

  return { customFields, fieldErrors };
}

// Build Zephyr testScript from TestRail case
// Handles 3 formats: separated steps array, plain text steps, BDD scenario
function buildTestScript(trCase) {
  // Format 1: Separated steps (most common — template "Test Case (Steps)")
  if (
    trCase.custom_steps_separated &&
    Array.isArray(trCase.custom_steps_separated) &&
    trCase.custom_steps_separated.length > 0
  ) {
    const steps = trCase.custom_steps_separated
      .filter(s => s && (s.content || s.step || s.description))
      .map((s, i) => ({
        description: (s.content || s.step || s.description || `Step ${i + 1}`).substring(0, 2000),
        expectedResult: (s.expected || s.expectedResult || '').substring(0, 2000),
        index: i + 1,
      }));
    if (steps.length > 0) {
      return { type: 'STEP_BY_STEP', steps };
    }
  }

  // Format 2: Plain text steps (template "Test Case (Text)")
  if (trCase.custom_steps && trCase.custom_steps.trim()) {
    const lines = trCase.custom_steps.split('\n').filter(l => l.trim());
    const expectedLines = trCase.custom_expected
      ? trCase.custom_expected.split('\n').filter(l => l.trim())
      : [];
    if (lines.length > 0) {
      return {
        type: 'STEP_BY_STEP',
        steps: lines.map((line, i) => ({
          description: line.trim().substring(0, 2000),
          expectedResult: (expectedLines[i] || '').trim().substring(0, 2000),
          index: i + 1,
        }))
      };
    }
  }

  // Format 3: BDD scenario
  if (trCase.custom_testrail_bdd_scenario && trCase.custom_testrail_bdd_scenario.trim()) {
    return {
      type: 'BDD',
      text: trCase.custom_testrail_bdd_scenario.substring(0, 8000)
    };
  }

  // No steps found
  return undefined;
}

// ── STEP 1: Init ──────────────────────────────────────────────────────────────

export async function initMigration(context) {
  const {
    cloudId, trUrl, trEmail, trToken, zToken, zBaseUrl,
    trProjectId, zProjectKey,
    migrateTestCases, migrateTestPlans, migrateTestCycles, migrateExecutions,
    dryRun, mappings, trCustomFields, trStatuses,
    retryFailedOnly,
  } = context;

  console.log(`[initMigration] dryRun=${dryRun}, retryFailedOnly=${retryFailedOnly}`);

  await saveContext(cloudId, {
    trUrl, trEmail, trToken, zToken, zBaseUrl,
    trProjectId, zProjectKey,
    migrateTestCases, migrateTestPlans, migrateTestCycles, migrateExecutions,
    dryRun, mappings, trCustomFields, trStatuses,
    retryFailedOnly: !!retryFailedOnly,
  });

  await initReport(cloudId);
  await updateReport(cloudId, { dryRun: !!dryRun });

  await saveQueue(cloudId, 'cases', []);
  await saveQueue(cloudId, 'plans', []);
  await saveQueue(cloudId, 'cycles', []);
  await saveQueue(cloudId, 'executions', []);
  await saveQueue(cloudId, 'suites', []);
  await saveQueue(cloudId, 'runs_for_exec', []);
  await saveQueue(cloudId, 'trUsers', []);

  const progress = {
    phase: 'fetching_users',
    suiteIndex: 0,
    runIndex: 0,
    casesDone: 0, casesTotal: 0,
    plansDone: 0, plansTotal: 0,
    cyclesDone: 0, cyclesTotal: 0,
    execsDone: 0, execsTotal: 0,
    status: 'running',
  };

  await saveProgress(cloudId, progress);
  return { success: true, progress };
}

// ── STEP 2: One chunk per call ────────────────────────────────────────────────

export async function runMigrationStep(cloudId) {
  const ctx = await getContext(cloudId);
  if (!ctx) return { success: false, error: 'No migration context — call initMigration first' };

  let progress = await getProgress(cloudId);
  if (!progress) return { success: false, error: 'No progress found' };
  if (progress.phase === 'done') return { success: true, progress, finished: true };

  const {
    trUrl, trEmail, trToken, zToken, zBaseUrl, zProjectKey,
    trProjectId, dryRun, mappings, trCustomFields, trStatuses,
    migrateTestCases, migrateTestPlans, migrateTestCycles, migrateExecutions,
    retryFailedOnly,
  } = ctx;

  const { statusMap, priorityMap, userMap } = mappings || {};
  const errors = [];

  const stepReport = {
    created: [], skipped: [], failed: [], summary: {}
  };

  function logCreated(entity, trId, name, zephyrKey) {
    console.log(`[${entity.toUpperCase()}] created: ${trId} -> ${zephyrKey}`);
    stepReport.created.push({ entity, trId, name, zephyrKey });
    stepReport.summary[entity] = stepReport.summary[entity] || { created: 0, skipped: 0, failed: 0 };
    stepReport.summary[entity].created++;
  }

  function logSkipped(entity, trId, name, reason) {
    stepReport.skipped.push({ entity, trId, name, reason });
    stepReport.summary[entity] = stepReport.summary[entity] || { created: 0, skipped: 0, failed: 0 };
    stepReport.summary[entity].skipped++;
  }

  function logFailed(entity, trId, name, error) {
    console.log(`[${entity.toUpperCase()}] FAILED: ${trId} - ${error}`);
    stepReport.failed.push({ entity, trId, name, error });
    errors.push({ entity, id: trId, msg: error, ts: Date.now() });
    stepReport.summary[entity] = stepReport.summary[entity] || { created: 0, skipped: 0, failed: 0 };
    stepReport.summary[entity].failed++;
  }

  try {

    // ── Fetch: users (for user mapping) ───────────────────────────────────
    if (progress.phase === 'fetching_users') {
      try {
        const users = await TR.getProjectUsers(trUrl, trEmail, trToken, trProjectId);
        await saveQueue(cloudId, 'trUsers', users);
        console.log(`[FETCH] users: ${users.length}`);
      } catch (e) {
        console.log(`[FETCH] users failed (non-fatal): ${e.message}`);
        await saveQueue(cloudId, 'trUsers', []);
      }
      progress.phase = migrateTestCases ? 'fetching_suites'
        : migrateTestPlans ? 'fetching_plans'
        : (migrateTestCycles || migrateExecutions) ? 'fetching_cycles'
        : 'done';
      await saveProgress(cloudId, progress);
      return { success: true, progress };
    }

    // ── Fetch: suites ──────────────────────────────────────────────────────
    if (progress.phase === 'fetching_suites') {
      const suites = await TR.getSuites(trUrl, trEmail, trToken, trProjectId);
      await saveQueue(cloudId, 'suites', suites);
      progress.phase = suites.length > 0 ? 'fetching_cases' : 'fetching_plans';
      progress.suiteIndex = 0;
      await saveProgress(cloudId, progress);
      return { success: true, progress };
    }

    // ── Fetch: cases (one suite per call) ──────────────────────────────────
    if (progress.phase === 'fetching_cases') {
      const suites = await getQueue(cloudId, 'suites') || [];
      const suite = suites[progress.suiteIndex];
      if (suite) {
        const cases = await TR.getCases(trUrl, trEmail, trToken, trProjectId, suite.id);
        const existing = await getQueue(cloudId, 'cases') || [];
        await saveQueue(cloudId, 'cases', existing.concat(cases));
        progress.casesTotal = existing.length + cases.length;
        progress.suiteIndex++;
        console.log(`[FETCH] suite ${suite.id} cases: ${cases.length}, total: ${progress.casesTotal}`);
      }
      if (progress.suiteIndex >= suites.length) {
        progress.phase = migrateTestPlans ? 'fetching_plans'
          : (migrateTestCycles || migrateExecutions) ? 'fetching_cycles'
          : progress.casesTotal > 0 ? 'cases' : 'done';
      }
      await saveProgress(cloudId, progress);
      return { success: true, progress };
    }

    // ── Fetch: plans ───────────────────────────────────────────────────────
    if (progress.phase === 'fetching_plans') {
      const plans = await TR.getPlans(trUrl, trEmail, trToken, trProjectId);
      await saveQueue(cloudId, 'plans', plans);
      progress.plansTotal = plans.length;
      progress.phase = (migrateTestCycles || migrateExecutions) ? 'fetching_cycles'
        : migrateTestCases && progress.casesTotal > 0 ? 'cases'
        : plans.length > 0 ? 'plans' : 'done';
      await saveProgress(cloudId, progress);
      return { success: true, progress };
    }

    // ── Fetch: cycles ──────────────────────────────────────────────────────
    if (progress.phase === 'fetching_cycles') {
      const runs = await TR.getRuns(trUrl, trEmail, trToken, trProjectId);
      await saveQueue(cloudId, 'cycles', runs);
      await saveQueue(cloudId, 'runs_for_exec', runs);
      progress.cyclesTotal = runs.length;
      progress.runIndex = 0;
      progress.phase = migrateExecutions && runs.length > 0 ? 'fetching_executions'
        : migrateTestCases && progress.casesTotal > 0 ? 'cases'
        : migrateTestPlans && progress.plansTotal > 0 ? 'plans'
        : migrateTestCycles && runs.length > 0 ? 'cycles' : 'done';
      await saveProgress(cloudId, progress);
      return { success: true, progress };
    }

    // ── Fetch: executions (one run per call) ───────────────────────────────
    if (progress.phase === 'fetching_executions') {
      const runs = await getQueue(cloudId, 'runs_for_exec') || [];
      const run = runs[progress.runIndex];
      if (run) {
        const results = await TR.getResultsForRun(trUrl, trEmail, trToken, run.id);
        const existing = await getQueue(cloudId, 'executions') || [];
        await saveQueue(cloudId, 'executions',
          existing.concat(results.map(r => ({ ...r, _runId: run.id })))
        );
        progress.execsTotal = existing.length + results.length;
        progress.runIndex++;
      }
      if (progress.runIndex >= runs.length) {
        progress.phase = migrateTestCases && progress.casesTotal > 0 ? 'cases'
          : migrateTestPlans && progress.plansTotal > 0 ? 'plans'
          : migrateTestCycles && progress.cyclesTotal > 0 ? 'cycles'
          : progress.execsTotal > 0 ? 'executions' : 'done';
      }
      await saveProgress(cloudId, progress);
      return { success: true, progress };
    }

    // ── Process: cases ─────────────────────────────────────────────────────
    if (progress.phase === 'cases') {
      const queue = await getQueue(cloudId, 'cases') || [];
      const trUsers = await getQueue(cloudId, 'trUsers') || [];

      if (progress.casesDone < queue.length) {
        const tc = queue[progress.casesDone];
        const existingKey = await getMapping(cloudId, 'case', tc.id);

        if (existingKey) {
          logSkipped('cases', tc.id, tc.title, `already migrated as ${existingKey}`);
        } else {
          try {
            const { customFields, fieldErrors } = buildCustomFields(tc, trCustomFields, mappings);
            fieldErrors.forEach(msg =>
              errors.push({ entity: 'testcase_field', id: tc.id, msg, ts: Date.now() })
            );

            if (!dryRun) {
              const testScript = buildTestScript(tc);

              // Log step info for debugging
              if (testScript) {
                console.log(`[CASE ${tc.id}] steps: ${testScript.type} - ${testScript.steps ? testScript.steps.length : 'BDD'} steps`);
              } else {
                console.log(`[CASE ${tc.id}] no steps found. custom_steps_separated=${JSON.stringify(tc.custom_steps_separated)?.substring(0, 100)}`);
              }

              // Resolve owner via user mapping
              const ownerId = mapUser(tc.created_by, trUsers, userMap)
                || mapUser(tc.updated_by, trUsers, userMap)
                || undefined;

              const created = await ZS.createTestCase(zToken, zBaseUrl, zProjectKey, {
                name: tc.title,
                objective: tc.custom_preconds ?? '',
                precondition: tc.custom_preconds ?? '',
                estimatedTime: tc.estimate_forecast
                  ? Math.round(parseFloat(tc.estimate_forecast) * 1000) : undefined,
                labels: [],
                priorityName: mapPriority(tc.priority_name, priorityMap),
                ownerId,
                customFields,
                testScript,
              });
              await saveMapping(cloudId, 'case', tc.id, created.key);
              logCreated('cases', tc.id, tc.title, created.key);
            } else {
              const testScript = buildTestScript(tc);
              console.log(`[DRY RUN CASE ${tc.id}] steps: ${testScript ? (testScript.steps ? testScript.steps.length + ' steps' : 'BDD') : 'none'}`);
              logSkipped('cases', tc.id, tc.title, 'dry run');
            }
          } catch (e) {
            logFailed('cases', tc.id, tc.title, e.message);
          }
        }
        progress.casesDone++;
      }

      await appendErrors(cloudId, errors);
      await updateReport(cloudId, stepReport);

      if (progress.casesDone >= queue.length) {
        progress.phase = migrateTestPlans && progress.plansTotal > 0 ? 'plans'
          : migrateTestCycles && progress.cyclesTotal > 0 ? 'cycles'
          : migrateExecutions && progress.execsTotal > 0 ? 'executions'
          : 'done';
      }
      await saveProgress(cloudId, progress);
      return { success: true, progress };
    }

    // ── Process: plans ─────────────────────────────────────────────────────
    if (progress.phase === 'plans') {
      const queue = await getQueue(cloudId, 'plans') || [];

      if (progress.plansDone < queue.length) {
        const plan = queue[progress.plansDone];
        const existingKey = await getMapping(cloudId, 'plan', plan.id);

        if (existingKey) {
          logSkipped('plans', plan.id, plan.name, `already migrated as ${existingKey}`);
        } else {
          try {
            if (!dryRun) {
              const created = await ZS.createTestPlan(zToken, zBaseUrl, zProjectKey, {
                name: plan.name,
                objective: plan.description ?? '',
              });
              await saveMapping(cloudId, 'plan', plan.id, created.key);
              logCreated('plans', plan.id, plan.name, created.key);
            } else {
              logSkipped('plans', plan.id, plan.name, 'dry run');
            }
          } catch (e) {
            logFailed('plans', plan.id, plan.name, e.message);
          }
        }
        progress.plansDone++;
      }

      await appendErrors(cloudId, errors);
      await updateReport(cloudId, stepReport);

      if (progress.plansDone >= queue.length) {
        progress.phase = migrateTestCycles && progress.cyclesTotal > 0 ? 'cycles'
          : migrateExecutions && progress.execsTotal > 0 ? 'executions'
          : 'done';
      }
      await saveProgress(cloudId, progress);
      return { success: true, progress };
    }

    // ── Process: cycles ────────────────────────────────────────────────────
    if (progress.phase === 'cycles') {
      const queue = await getQueue(cloudId, 'cycles') || [];

      if (progress.cyclesDone < queue.length) {
        const run = queue[progress.cyclesDone];
        const existingKey = await getMapping(cloudId, 'cycle', run.id);

        if (existingKey) {
          logSkipped('cycles', run.id, run.name, `already migrated as ${existingKey}`);
        } else {
          try {
            if (!dryRun) {
              const created = await ZS.createTestCycle(zToken, zBaseUrl, zProjectKey, {
                name: run.name,
                description: run.description ?? '',
              });
              await saveMapping(cloudId, 'cycle', run.id, created.key);
              logCreated('cycles', run.id, run.name, created.key);
            } else {
              logSkipped('cycles', run.id, run.name, 'dry run');
            }
          } catch (e) {
            logFailed('cycles', run.id, run.name, e.message);
          }
        }
        progress.cyclesDone++;
      }

      await appendErrors(cloudId, errors);
      await updateReport(cloudId, stepReport);

      if (progress.cyclesDone >= queue.length) {
        progress.phase = migrateExecutions && progress.execsTotal > 0 ? 'executions' : 'done';
      }
      await saveProgress(cloudId, progress);
      return { success: true, progress };
    }

    // ── Process: executions ────────────────────────────────────────────────
    if (progress.phase === 'executions') {
      const queue = await getQueue(cloudId, 'executions') || [];
      const trUsers = await getQueue(cloudId, 'trUsers') || [];

      if (progress.execsDone < queue.length) {
        const result = queue[progress.execsDone];
        const cycleKey = await getMapping(cloudId, 'cycle', result._runId);
        const caseKey = await getMapping(cloudId, 'case', result.case_id);
        const execName = `exec_${result.id}`;

        if (!cycleKey) {
          logFailed('executions', result.id, execName,
            `No cycle mapping for run ${result._runId}`);
        } else if (!caseKey) {
          logFailed('executions', result.id, execName,
            `No case mapping for case ${result.case_id}`);
        } else {
          try {
            if (!dryRun) {
              // Resolve assigned user via user mapping
              const assignedToId = mapUser(result.tested_by, trUsers, userMap)
                || mapUser(result.assignedto_id, trUsers, userMap)
                || undefined;

              await ZS.createTestExecution(zToken, zBaseUrl, zProjectKey, cycleKey, {
                testCaseKey: caseKey,
                statusName: mapStatus(result.status_id, trStatuses, statusMap),
                comment: result.comment ?? '',
                assignedToId,
              });
              logCreated('executions', result.id, execName, `${cycleKey}+${caseKey}`);
              await new Promise(r => setTimeout(r, 300));
            } else {
              logSkipped('executions', result.id, execName, 'dry run');
            }
          } catch (e) {
            logFailed('executions', result.id, execName, e.message);
          }
        }
        progress.execsDone++;
      }

      await appendErrors(cloudId, errors);
      await updateReport(cloudId, stepReport);

      if (progress.execsDone >= queue.length) {
        progress.phase = 'done';
        await updateReport(cloudId, { completedAt: new Date().toISOString() });
      }
      await saveProgress(cloudId, progress);
      return { success: true, progress };
    }

  } catch (e) {
    console.log(`[runMigrationStep] error: ${e.message}`);
    return { success: false, error: e.message };
  }

  progress.phase = 'done';
  progress.status = 'complete';
  await updateReport(cloudId, { completedAt: new Date().toISOString() });
  await saveProgress(cloudId, progress);
  return { success: true, progress, finished: true };
}


