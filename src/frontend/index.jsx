import React, { useState } from 'react';
import ForgeReconciler, {
  Text, Button, Heading, Stack, Box,
  SectionMessage, Inline, Spinner,
  Textfield, Select, Checkbox, Label, Strong
} from '@forge/react';
import { invoke } from '@forge/bridge'; 

// ─── Suggestions for pre-filling obvious matches ────────────────────────────

const STATUS_SUGGESTIONS = {
  'Passed': 'Pass',
  'Failed': 'Fail',
  'Blocked': 'Blocked',
  'Untested': 'Not Executed',
  'Retest': 'In Progress',
  'Skipped': 'Not Executed'
};

const PRIORITY_SUGGESTIONS = {
  'Critical': 'High',
  'High': 'High',
  'Medium': 'Normal',
  'Low': 'Low'
};

// These labels match EXACTLY what appears in Zephyr's "Choose a type" dropdown
const ZEPHYR_FIELD_TYPE_GUIDE = {
  1: { zType: 'Text Field (Single Line)', steps: 'In the "Choose a type" dropdown, select "Text Field (Single Line)".' },
  2: { zType: 'Number', steps: 'In the "Choose a type" dropdown, select "Number".' },
  3: { zType: 'Text Field (Multi Line)', steps: 'In the "Choose a type" dropdown, select "Text Field (Multi Line)".' },
  4: { zType: 'Text Field (Single Line)', steps: 'In the "Choose a type" dropdown, select "Text Field (Single Line)". Zephyr has no dedicated URL type.' },
  5: { zType: 'Checkbox', steps: 'In the "Choose a type" dropdown, select "Checkbox".' },
  6: { zType: 'Select List (Single Choice)', steps: 'In the "Choose a type" dropdown, select "Select List (Single Choice)", then add the exact options listed below as the choices.' },
  7: { zType: 'User Picker', steps: 'In the "Choose a type" dropdown, select "User Picker". Note: TestRail user values cannot be auto-migrated — the field will be created but left empty.' },
  8: { zType: 'Date Picker', steps: 'In the "Choose a type" dropdown, select "Date Picker".' },
  9: { zType: 'Text Field (Single Line)', steps: 'Milestones have no direct Zephyr equivalent. If you want to preserve the milestone name, select "Text Field (Single Line)".' },
  10: { zType: 'Not needed', steps: 'This is a test step field. It is migrated automatically into the test case steps — you do not need to create anything in Zephyr for this.' },
  12: { zType: 'Select List (Multi Choice)', steps: 'In the "Choose a type" dropdown, select "Select List (Multi Choice)", then add the exact options listed below as the choices.' },
  13: { zType: 'Not needed', steps: 'This is a BDD scenario field. It is migrated automatically into the test case steps — you do not need to create anything in Zephyr for this.' }
};

function getFieldTypeGuide(typeId) {
  return ZEPHYR_FIELD_TYPE_GUIDE[typeId] || { zType: 'Single Line Text', steps: 'Choose a text-based field type.' };
}

// ─── App ─────────────────────────────────────────────────────────────────────

const App = () => {
  // Wizard step: 0=Credentials, 1=Connect, 2=Mapping, 3=Options, 4=Migrate
  const [step, setStep] = useState(0);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState('');

  // Step 0 - Credentials
  const [trUrl, setTrUrl] = useState('');
  const [trEmail, setTrEmail] = useState('');
  const [trToken, setTrToken] = useState('');
  const [zToken, setZToken] = useState('');
  const [zBaseUrl, setZBaseUrl] = useState('https://prod-play.zephyr4jiracloud.com/connect/v2');

  // Step 1 - Connections
  const [trOk, setTrOk] = useState(null);
  const [zOk, setZOk] = useState(null);
  const [trErr, setTrErr] = useState('');
  const [zErr, setZErr] = useState('');
  const [trProjects, setTrProjects] = useState([]);
  const [zProjects, setZProjects] = useState([]);

  // Step 2 - Mapping data fetched
  const [mappingLoaded, setMappingLoaded] = useState(false);
  const [mappingErrors, setMappingErrors] = useState([]);
  const [trStatuses, setTrStatuses] = useState([]);
  const [trPriorities, setTrPriorities] = useState([]);
  const [trCustomFields, setTrCustomFields] = useState([]);
  const [zStatuses, setZStatuses] = useState([]);
  const [zPriorities, setZPriorities] = useState([]);

  // User-entered mappings
  const [statusMap, setStatusMap] = useState({});
  const [priorityMap, setPriorityMap] = useState({});
  const [fieldMap, setFieldMap] = useState({});
  // optionMap: { trSystemName -> { trOptionId -> zephyrOptionLabel } }
  const [optionMap, setOptionMap] = useState({});

  // Step 3 - Options
  const [trProj, setTrProj] = useState('');
  const [zProj, setZProj] = useState('');
  const [migrateTestCases, setMigrateTestCases] = useState(true);
  const [migrateTestPlans, setMigrateTestPlans] = useState(true);
  const [migrateTestCycles, setMigrateTestCycles] = useState(true);
  const [migrateExecutions, setMigrateExecutions] = useState(true);
  const [dryRun, setDryRun] = useState(true);

  // Step 4 - Migration results
  const [migrationDone, setMigrationDone] = useState(false);
  const [migrationError, setMigrationError] = useState('');
  const [progress, setProgress] = useState(null);

  // Step 4 - Report / Retry / Clear (NEW)
  const [migrationReport, setMigrationReport] = useState(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [storageSummary, setStorageSummary] = useState(null);
  const [clearing, setClearing] = useState(false);

  const stepNames = ['Credentials', 'Connect', 'Field Mapping', 'Options', 'Migrate'];

  // ─── Step 1: Test Connections ──────────────────────────────────────────────

  async function testConnections() {
    setLoading(true);
    setLoadingMsg('Testing connections...');
    setTrOk(null); setZOk(null);
    setTrErr(''); setZErr('');

    const [tr, z] = await Promise.all([
      invoke('testTestrailConnection', { trUrl, trEmail, trToken }),
      invoke('testZephyrConnection', { zToken, zBaseUrl })
    ]);

    if (tr.ok) { setTrOk(true); setTrProjects(tr.projects || []); }
    else { setTrOk(false); setTrErr(tr.error || 'Connection failed'); }

    if (z.ok) { setZOk(true); setZProjects(z.projects || []); }
    else { setZOk(false); setZErr(z.error || 'Connection failed'); }

    setLoading(false);
    setLoadingMsg('');
  }

  // ─── Step 2: Load Mapping Data ─────────────────────────────────────────────

  async function loadMappingData(selectedZProjectKey) {
    setLoading(true);
    setLoadingMsg('Fetching TestRail fields and Zephyr statuses...');
    setMappingLoaded(false);
    setMappingErrors([]);

    const result = await invoke('fetchMappingData', {
      trUrl, trEmail, trToken,
      zToken, zBaseUrl,
      zProjectKey: selectedZProjectKey
    });

    setLoading(false);
    setLoadingMsg('');

    if (!result) {
      setMappingErrors(['Failed to fetch mapping data - check tunnel logs']);
      return;
    }

    setTrStatuses(result.trStatuses || []);
    setTrPriorities(result.trPriorities || []);
    setTrCustomFields(result.trCustomFields || []);
    setZStatuses(result.zStatuses || []);
    setZPriorities(result.zPriorities || []);

    if (result.errors && result.errors.length > 0) {
      setMappingErrors(result.errors);
    }

    // Pre-fill status suggestions
    const initStatus = {};
    (result.trStatuses || []).forEach(s => {
      initStatus[s.label] = STATUS_SUGGESTIONS[s.label] || '';
    });
    setStatusMap(initStatus);

    // Pre-fill priority suggestions
    const initPriority = {};
    (result.trPriorities || []).forEach(p => {
      initPriority[p.name] = PRIORITY_SUGGESTIONS[p.name] || '';
    });
    setPriorityMap(initPriority);

    // Init empty field map
    const initFields = {};
    (result.trCustomFields || []).forEach(f => {
      initFields[f.systemName] = '';
    });
    setFieldMap(initFields);

    // Pre-fill option map with TestRail labels as default
    const initOptions = {};
    (result.trCustomFields || []).forEach(f => {
      if (f.options && f.options.length > 0) {
        initOptions[f.systemName] = {};
        f.options.forEach(opt => {
          initOptions[f.systemName][opt.id] = opt.label;
        });
      }
    });
    setOptionMap(initOptions);

    setMappingLoaded(true);
  }

  // ─── Step 4: Run Migration — CHUNKED LOOP APPROACH ─────────────────────────
  // Calls startMigration (fast setup only), then loops calling runMigrationStep
  // repeatedly, each one processing a small chunk and returning quickly, until
  // the whole migration is done. Accepts retryFailedOnly so the same function
  // can drive both "Start Migration" and "Retry Failed Items".

  async function startMigration(retryFailedOnly = false) {
    setLoading(true);
    setLoadingMsg(retryFailedOnly ? 'Initializing retry...' : 'Initializing migration...');
    setMigrationDone(false);
    setMigrationError('');
    setProgress(null);
    setMigrationReport(null);

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    try {
      // Step 1: Initialize - fetches all lists, saves to storage, returns fast
      const initRes = await invoke('startMigration', {
        trUrl, trEmail, trToken, zToken, zBaseUrl,
        trProjectId: trProj, zProjectKey: zProj,
        migrateTestCases, migrateTestPlans,
        migrateTestCycles, migrateExecutions, dryRun,
        mappings: { statusMap, priorityMap, fieldMap, optionMap },
        trCustomFields, trStatuses,
        retryFailedOnly,
      });

      if (!initRes.success) {
        setMigrationError(initRes.error || 'Failed to initialize migration');
        setLoading(false);
        return;
      }

      setProgress(initRes.progress);

      // Step 2: Loop calling runMigrationStep until phase === 'done'
      let currentProgress = initRes.progress;
      let safetyCounter = 0;
      const MAX_STEPS = 10000; // safety limit to avoid an infinite loop
      let retryCount = 0;
      const MAX_RETRIES = 3;

      while (currentProgress.phase !== 'done' && safetyCounter < MAX_STEPS) {
        const phase = currentProgress.phase || 'processing';
        const phaseDisplay = {
          'fetching_suites': 'Fetching suites...',
          'fetching_cases': `Fetching test cases (suite ${currentProgress.suiteIndex})...`,
          'fetching_plans': 'Fetching test plans...',
          'fetching_cycles': 'Fetching test cycles...',
          'fetching_executions': `Fetching executions (run ${currentProgress.runIndex})...`,
          'cases': `Migrating test cases (${currentProgress.casesDone || 0} / ${currentProgress.casesTotal || '?'})`,
          'plans': `Migrating test plans (${currentProgress.plansDone || 0} / ${currentProgress.plansTotal || '?'})`,
          'cycles': `Migrating test cycles (${currentProgress.cyclesDone || 0} / ${currentProgress.cyclesTotal || '?'})`,
          'executions': `Migrating executions (${currentProgress.execsDone || 0} / ${currentProgress.execsTotal || '?'})`,
        };
        setLoadingMsg(phaseDisplay[phase] || `Processing ${phase}...`);

        try {
          const stepRes = await invoke('runMigrationStep', {});

          if (!stepRes.success) {
            if (stepRes.error && stepRes.error.includes('authorization expired') && retryCount < MAX_RETRIES) {
              retryCount++;
              setLoadingMsg(`Temporary auth error - retrying in 5s (${retryCount}/${MAX_RETRIES})...`);
              await sleep(5000);
              continue;
            }
            setMigrationError(stepRes.error || 'Migration step failed');
            setLoading(false);
            return;
          }

          retryCount = 0;
          currentProgress = stepRes.progress;
          setProgress(currentProgress);
          safetyCounter++;

          if (currentProgress.phase !== 'done') {
            await sleep(2000);
          }

        } catch (e) {
          if (retryCount < MAX_RETRIES) {
            retryCount++;
            setLoadingMsg(`Network error - retrying in 5s (${retryCount}/${MAX_RETRIES})...`);
            await sleep(5000);
            continue;
          }
          setLoading(false);
          setMigrationError(e.message || 'Migration failed unexpectedly');
          return;
        }
      }

      // Fetch the final report
      const reportRes = await invoke('getMigrationReport', {});
      if (reportRes.report) setMigrationReport(reportRes.report);

      setLoading(false);
      setLoadingMsg('');
      setMigrationDone(true);

    } catch (e) {
      setLoading(false);
      setLoadingMsg('');
      setMigrationError(e.message || 'Migration failed unexpectedly');
    }
  }

  // ─── Step 4: Clear stored data (with confirmation) ─────────────────────────

  async function checkStorageAndConfirmClear() {
    setClearing(true);
    const res = await invoke('getStorageSummary', {});
    setStorageSummary(res.summary);
    setClearing(false);
    setShowClearConfirm(true);
  }

  async function clearMigrationData() {
    setClearing(true);
    setShowClearConfirm(false);
    const res = await invoke('clearMigrationData', {});
    setClearing(false);
    if (res.success) {
      setProgress(null);
      setMigrationDone(false);
      setMigrationError('');
      setMigrationReport(null);
      setStorageSummary(null);
      setLoadingMsg('All stored migration data cleared. Ready to start fresh.');
    } else {
      setMigrationError('Failed to clear: ' + res.error);
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const trProjOptions = trProjects.map(p => ({ label: p.name, value: String(p.id) }));
  const zProjOptions = zProjects.map(p => ({
    label: p.name && p.name !== p.key ? `${p.key} - ${p.name}` : (p.key || String(p.id)),
    value: p.key || String(p.id)
  }));
  const zStatusOptions = zStatuses.map(s => ({ label: s.name, value: s.name }));
  const zPriorityOptions = zPriorities.map(p => ({ label: p.name, value: p.name }));

  const mappingComplete = () => {
    const allStatuses = trStatuses.every(s => statusMap[s.label]);
    const allPriorities = trPriorities.every(p => priorityMap[p.name]);
    return allStatuses && allPriorities;
  };

  // ─── RENDER ────────────────────────────────────────────────────────────────

  return (
    <Box padding="space.400">
      <Stack space="space.400">

        <Stack space="space.100">
          <Heading as="h1">TestRail to Zephyr Migrator</Heading>
          <Text>Migrate test cases, plans, cycles and executions from TestRail to Zephyr Scale.</Text>
          <Text>Step {step + 1} of 5 - {stepNames[step]}</Text>
        </Stack>

        {/* STEP 0 - Credentials */}
        {step === 0 && (
          <Stack space="space.200">
            <Heading as="h2">Step 1 - Enter Credentials</Heading>

            <SectionMessage appearance="information">
              <Text>
                TestRail API key: My Settings, API Keys, Add Key.
                Zephyr token: Zephyr Scale, Settings, API Access Tokens, Generate Token.
              </Text>
            </SectionMessage>

            <Heading as="h3">TestRail</Heading>

            <Label labelFor="trUrl">TestRail URL</Label>
            <Textfield
              id="trUrl"
              placeholder="https://yourcompany.testrail.io"
              value={trUrl}
              onChange={e => setTrUrl(e.target.value)}
            />

            <Label labelFor="trEmail">Email address</Label>
            <Textfield
              id="trEmail"
              placeholder="you@company.com"
              value={trEmail}
              onChange={e => setTrEmail(e.target.value)}
            />

            <Label labelFor="trToken">API Key</Label>
            <Textfield
              id="trToken"
              placeholder="Your TestRail API key"
              type="password"
              value={trToken}
              onChange={e => setTrToken(e.target.value)}
            />

            <Heading as="h3">Zephyr Scale</Heading>

            <Label labelFor="zBaseUrl">Zephyr Base URL</Label>
            <Textfield
              id="zBaseUrl"
              placeholder="https://prod-play.zephyr4jiracloud.com/connect/v2"
              value={zBaseUrl}
              onChange={e => setZBaseUrl(e.target.value)}
            />

            <Label labelFor="zToken">Zephyr Scale API Token</Label>
            <Textfield
              id="zToken"
              placeholder="Your Zephyr Scale API token"
              type="password"
              value={zToken}
              onChange={e => setZToken(e.target.value)}
            />

            <Inline>
              <Button
                appearance="primary"
                onClick={() => setStep(1)}
                isDisabled={!trUrl || !trEmail || !trToken || !zToken}
              >
                Next: Test Connections
              </Button>
            </Inline>
          </Stack>
        )}

        {/* STEP 1 - Test Connections */}
        {step === 1 && (
          <Stack space="space.200">
            <Heading as="h2">Step 2 - Test Connections</Heading>
            <Text>Click below to verify both API connections before proceeding.</Text>

            {trOk === true && (
              <SectionMessage appearance="success">
                <Text>TestRail connected - {trProjects.length} projects found</Text>
              </SectionMessage>
            )}
            {trOk === false && (
              <SectionMessage appearance="error">
                <Text>TestRail failed: {trErr}</Text>
              </SectionMessage>
            )}
            {zOk === true && (
              <SectionMessage appearance="success">
                <Text>Zephyr Scale connected - {zProjects.length} projects found</Text>
              </SectionMessage>
            )}
            {zOk === false && (
              <SectionMessage appearance="error">
                <Text>Zephyr failed: {zErr}</Text>
              </SectionMessage>
            )}

            {loading && (
              <Stack space="space.100">
                <Spinner size="medium" />
                <Text>{loadingMsg}</Text>
              </Stack>
            )}

            <Inline space="space.100">
              <Button onClick={() => setStep(0)}>Back</Button>
              <Button appearance="primary" onClick={testConnections} isDisabled={loading}>
                {loading ? 'Testing...' : 'Test Both Connections'}
              </Button>
              {trOk && zOk && (
                <Button appearance="primary" onClick={() => setStep(2)} isDisabled={loading}>
                  Next: Field Mapping
                </Button>
              )}
            </Inline>
          </Stack>
        )}

        {/* STEP 2 - Field Mapping */}
        {step === 2 && (
          <Stack space="space.300">
            <Heading as="h2">Step 3 - Field Mapping</Heading>

            <SectionMessage appearance="information">
              <Text>
                Select the Zephyr project first. Then map each TestRail status, priority and custom field
                to the corresponding name in your Zephyr project. Statuses and priorities are required.
                Custom fields are optional - leave blank to skip that field.
              </Text>
            </SectionMessage>

            <Label labelFor="zProjMapping">Select Zephyr project (to load its statuses and priorities)</Label>
            <Select
              inputId="zProjMapping"
              options={zProjOptions}
              placeholder="Select Zephyr project..."
              onChange={opt => {
                setZProj(opt.value);
                loadMappingData(opt.value);
              }}
            />

            {loading && (
              <Stack space="space.100">
                <Spinner size="medium" />
                <Text>{loadingMsg}</Text>
              </Stack>
            )}

            {mappingErrors.length > 0 && (
              <SectionMessage appearance="warning">
                <Stack space="space.100">
                  <Text>Some data could not be fetched:</Text>
                  {mappingErrors.map((e, i) => <Text key={i}>{e}</Text>)}
                </Stack>
              </SectionMessage>
            )}

            {mappingLoaded && (
              <Stack space="space.300">

                {/* Status Mapping */}
                <Heading as="h3">Execution Status Mapping</Heading>
                <SectionMessage appearance="information">
                  <Text>
                    Map each TestRail status to its equivalent in your Zephyr project.
                    Your Zephyr statuses are shown in the dropdown.
                    All statuses must be mapped before proceeding.
                  </Text>
                </SectionMessage>

                {trStatuses.map(s => (
                  <Stack key={s.id} space="space.050">
                    <Text>TestRail: [{s.id}] {s.label} {s.isSystem ? '(system)' : '(custom)'}</Text>
                    <Select
                      inputId={`status_${s.id}`}
                      options={zStatusOptions}
                      placeholder="Select Zephyr status..."
                      value={statusMap[s.label] ? { label: statusMap[s.label], value: statusMap[s.label] } : null}
                      onChange={opt => setStatusMap(prev => ({ ...prev, [s.label]: opt.value }))}
                    />
                  </Stack>
                ))}

                {/* Priority Mapping */}
                <Heading as="h3">Priority Mapping</Heading>
                <SectionMessage appearance="information">
                  <Text>
                    Map each TestRail priority to its equivalent in your Zephyr project.
                    Note: Zephyr has High, Normal, Low. TestRail Critical can map to High.
                  </Text>
                </SectionMessage>

                {trPriorities.map(p => (
                  <Stack key={p.id} space="space.050">
                    <Text>TestRail: [{p.id}] {p.name} {p.isDefault ? '(default)' : ''}</Text>
                    <Select
                      inputId={`priority_${p.id}`}
                      options={zPriorityOptions}
                      placeholder="Select Zephyr priority..."
                      value={priorityMap[p.name] ? { label: priorityMap[p.name], value: priorityMap[p.name] } : null}
                      onChange={opt => setPriorityMap(prev => ({ ...prev, [p.name]: opt.value }))}
                    />
                  </Stack>
                ))}

                {/* Custom Field Mapping */}
                <Heading as="h3">Custom Field Mapping (Optional)</Heading>
                <SectionMessage appearance="information">
                  <Stack space="space.100">
                    <Text>
                      For each field below, first create a matching custom field in your Zephyr project,
                      then type the exact name you gave it in Zephyr.
                    </Text>
                    <Text>
                      Go to: Zephyr Project Settings, then Custom Fields, then Test Case
                      (the section depends on which entity the field belongs to).
                    </Text>
                  </Stack>
                </SectionMessage>
                <SectionMessage appearance="warning">
                  <Text>
                    The exact field type names below match Zephyr Scale's standard configuration screen.
                    If your version shows slightly different wording, choose the closest matching type -
                    for example, a single-choice dropdown is sometimes labeled differently across Zephyr versions.
                  </Text>
                </SectionMessage>

                {trCustomFields.filter(f => f.typeId !== 10 && f.typeId !== 13).map(f => {
                  const guide = getFieldTypeGuide(f.typeId);
                  return (
                    <Box key={f.id} padding="space.200">
                      <Stack space="space.100">
                        <Text><Strong>TestRail field: {f.label}</Strong></Text>
                        <Text>TestRail type: {f.typeName}{f.isRequired ? ' (required in TestRail)' : ''}</Text>

                        <SectionMessage appearance="discovery">
                          <Stack space="space.075">
                            <Text><Strong>How to create this field in Zephyr:</Strong></Text>
                            <Text>1. Go to Project Settings then Custom Fields</Text>
                            <Text>2. Click "Add Field"</Text>
                            <Text>3. In the "Choose a type" dropdown, select exactly: <Strong>{guide.zType}</Strong></Text>
                            {f.options && f.options.length > 0 && (
                              <Text>4. Add these choices one by one: {f.options.map(o => o.label).join(', ')}</Text>
                            )}
                            <Text>{f.options && f.options.length > 0 ? '5.' : '4.'} Name the field anything you like, then type that exact name in the box below</Text>
                          </Stack>
                        </SectionMessage>

                        <Label labelFor={`field_${f.id}`}>
                          Zephyr field name (type exactly as you created it, or leave blank to skip)
                        </Label>
                        <Textfield
                          id={`field_${f.id}`}
                          placeholder={f.label}
                          value={fieldMap[f.systemName] || ''}
                          onChange={e => setFieldMap(prev => ({ ...prev, [f.systemName]: e.target.value }))}
                        />

                        {(f.typeId === 6 || f.typeId === 12) && f.options && f.options.length > 0 && fieldMap[f.systemName] && (
                          <Stack space="space.050">
                            <Text>Now map each TestRail option to the exact Zephyr option text:</Text>
                            {f.options.map(opt => (
                              <Inline key={opt.id} space="space.100" alignBlock="center">
                                <Text>"{opt.label}" (ID: {opt.id}) maps to</Text>
                                <Textfield
                                  id={`opt_${f.id}_${opt.id}`}
                                  placeholder={opt.label}
                                  value={(optionMap[f.systemName] && optionMap[f.systemName][opt.id]) || opt.label}
                                  onChange={e => setOptionMap(prev => ({
                                    ...prev,
                                    [f.systemName]: {
                                      ...(prev[f.systemName] || {}),
                                      [opt.id]: e.target.value
                                    }
                                  }))}
                                />
                              </Inline>
                            ))}
                          </Stack>
                        )}
                      </Stack>
                    </Box>
                  );
                })}

                <Inline space="space.100">
                  <Button onClick={() => setStep(1)}>Back</Button>
                  <Button
                    appearance="primary"
                    onClick={() => setStep(3)}
                    isDisabled={!mappingComplete()}
                  >
                    Next: Migration Options
                  </Button>
                </Inline>

                {!mappingComplete() && (
                  <SectionMessage appearance="warning">
                    <Text>Please map all statuses and priorities before continuing.</Text>
                  </SectionMessage>
                )}

              </Stack>
            )}

            {!mappingLoaded && !loading && (
              <Inline>
                <Button onClick={() => setStep(1)}>Back</Button>
              </Inline>
            )}
          </Stack>
        )}

        {/* STEP 3 - Migration Options */}
        {step === 3 && (
          <Stack space="space.200">
            <Heading as="h2">Step 4 - Migration Options</Heading>

            <Label labelFor="trProj">Migrate FROM (TestRail project)</Label>
            <Select
              inputId="trProj"
              options={trProjOptions}
              placeholder="Select TestRail project..."
              onChange={opt => setTrProj(opt.value)}
            />

            <Heading as="h3">What to migrate</Heading>
            <Stack space="space.100">
              <Checkbox
                label="Test Cases - all test cases with steps and custom fields"
                isChecked={migrateTestCases}
                onChange={e => setMigrateTestCases(e.target.checked)}
              />
              <Checkbox
                label="Test Plans - test plans and associated runs"
                isChecked={migrateTestPlans}
                onChange={e => setMigrateTestPlans(e.target.checked)}
              />
              <Checkbox
                label="Test Cycles - test cycles linked to plans"
                isChecked={migrateTestCycles}
                onChange={e => setMigrateTestCycles(e.target.checked)}
              />
              <Checkbox
                label="Test Executions - execution history with Pass/Fail/Blocked"
                isChecked={migrateExecutions}
                onChange={e => setMigrateExecutions(e.target.checked)}
              />
            </Stack>

            <SectionMessage appearance="warning">
              <Stack space="space.100">
                <Checkbox
                  label="Enable Dry Run Mode (recommended for first run)"
                  isChecked={dryRun}
                  onChange={e => setDryRun(e.target.checked)}
                />
                <Text>Dry Run simulates migration without creating anything in Zephyr. Always run this first.</Text>
              </Stack>
            </SectionMessage>

            <Inline space="space.100">
              <Button onClick={() => setStep(2)}>Back</Button>
              <Button
                appearance="primary"
                onClick={() => setStep(4)}
                isDisabled={!trProj}
              >
                Next: Review and Migrate
              </Button>
            </Inline>
          </Stack>
        )}

        {/* STEP 4 - Migrate */}
        {step === 4 && (
          <Stack space="space.200">
            <Heading as="h2">{dryRun ? 'Step 5 - Dry Run' : 'Step 5 - Live Migration'}</Heading>

            <SectionMessage appearance="information">
              <Stack space="space.100">
                <Text>From: TestRail project {trProj}</Text>
                <Text>To: Zephyr project {zProj}</Text>
                <Text>Migrating: {[
                  migrateTestCases && 'Test Cases',
                  migrateTestPlans && 'Test Plans',
                  migrateTestCycles && 'Test Cycles',
                  migrateExecutions && 'Executions'
                ].filter(Boolean).join(', ')}</Text>
                <Text>Mode: {dryRun ? 'DRY RUN - nothing will be created' : 'LIVE MIGRATION'}</Text>
              </Stack>
            </SectionMessage>

            <Heading as="h3">Status Mapping Summary</Heading>
            {trStatuses.map(s => (
              <Text key={s.id}>{s.label} maps to {statusMap[s.label] || 'NOT MAPPED'}</Text>
            ))}

            <Heading as="h3">Priority Mapping Summary</Heading>
            {trPriorities.map(p => (
              <Text key={p.id}>{p.name} maps to {priorityMap[p.name] || 'NOT MAPPED'}</Text>
            ))}

            {loading && progress && (
              <Stack space="space.150">
                <Inline space="space.100" alignBlock="center">
                  <Spinner size="small" />
                  <Text><Strong>{loadingMsg}</Strong></Text>
                </Inline>

                <Box padding="space.150">
                  <Stack space="space.075">
                    {['fetching_suites', 'fetching_cases', 'fetching_plans', 'fetching_cycles', 'fetching_executions']
                      .includes(progress.phase) ? (
                      <Text>Fetching data from TestRail... ({progress.phase.replace('fetching_', '')})</Text>
                    ) : null}
                    <Text>Test Cases: {progress.casesDone || 0} of {progress.casesTotal || '?'}</Text>
                    <Text>Test Plans: {progress.plansDone || 0} of {progress.plansTotal || '?'}</Text>
                    <Text>Test Cycles: {progress.cyclesDone || 0} of {progress.cyclesTotal || '?'}</Text>
                    <Text>Executions: {progress.execsDone || 0} of {progress.execsTotal || '?'}</Text>
                  </Stack>
                </Box>
              </Stack>
            )}

            {progress && migrationDone && (
              <SectionMessage appearance="success">
                <Stack space="space.100">
                  <Text>Migration complete!</Text>
                  <Text>Test Cases: {progress.casesDone} / {progress.casesTotal}</Text>
                  <Text>Test Plans: {progress.plansDone} / {progress.plansTotal}</Text>
                  <Text>Test Cycles: {progress.cyclesDone} / {progress.cyclesTotal}</Text>
                  <Text>Executions: {progress.execsDone} / {progress.execsTotal}</Text>
                </Stack>
              </SectionMessage>
            )}

            {migrationError && (
              <SectionMessage appearance="error">
                <Text>Error: {migrationError}</Text>
              </SectionMessage>
            )}

            {/* Clear confirmation dialog (NEW) */}
            {showClearConfirm && (
              <SectionMessage appearance="warning">
                <Stack space="space.100">
                  <Text><Strong>Clear all stored migration data?</Strong></Text>
                  {storageSummary && storageSummary.lastRun && (
                    <Stack space="space.050">
                      <Text>Last run: {storageSummary.lastRun.startedAt}</Text>
                      <Text>Cases migrated: {storageSummary.lastRun.summary.cases.created}</Text>
                      <Text>Cycles migrated: {storageSummary.lastRun.summary.cycles.created}</Text>
                      <Text>Executions migrated: {storageSummary.lastRun.summary.executions.created}</Text>
                      <Text>Failed items: {
                        (storageSummary.lastRun.summary.cases.failed || 0) +
                        (storageSummary.lastRun.summary.cycles.failed || 0) +
                        (storageSummary.lastRun.summary.executions.failed || 0)
                      }</Text>
                    </Stack>
                  )}
                  <Text>This will delete all ID mappings, queues, and progress data. This cannot be undone.</Text>
                  <Inline space="space.100">
                    <Button onClick={() => setShowClearConfirm(false)}>Cancel</Button>
                    <Button appearance="danger" onClick={clearMigrationData}>
                      Yes, Clear All Data
                    </Button>
                  </Inline>
                </Stack>
              </SectionMessage>
            )}

            {/* Migration Report (NEW) */}
            {migrationReport && migrationDone && (
              <Stack space="space.150">
                <Heading as="h3">Migration Report</Heading>

                <SectionMessage appearance={
                  (migrationReport.summary.cases.failed + migrationReport.summary.cycles.failed +
                    migrationReport.summary.executions.failed) > 0 ? 'warning' : 'success'
                }>
                  <Stack space="space.100">
                    <Text><Strong>Summary</Strong></Text>
                    <Text>Mode: {migrationReport.dryRun ? 'Dry Run' : 'Live Migration'}</Text>
                    <Text>Test Cases: {migrationReport.summary.cases.created} created, {migrationReport.summary.cases.skipped} skipped, {migrationReport.summary.cases.failed} failed</Text>
                    <Text>Test Plans: {migrationReport.summary.plans.created} created, {migrationReport.summary.plans.skipped} skipped, {migrationReport.summary.plans.failed} failed</Text>
                    <Text>Test Cycles: {migrationReport.summary.cycles.created} created, {migrationReport.summary.cycles.skipped} skipped, {migrationReport.summary.cycles.failed} failed</Text>
                    <Text>Executions: {migrationReport.summary.executions.created} created, {migrationReport.summary.executions.skipped} skipped, {migrationReport.summary.executions.failed} failed</Text>
                  </Stack>
                </SectionMessage>

                {migrationReport.failed && migrationReport.failed.length > 0 && (
                  <Stack space="space.050">
                    <Text><Strong>Failed items (need attention):</Strong></Text>
                    {migrationReport.failed.slice(0, 20).map((item, i) => (
                      <Text key={i}>{item.entity} ID {item.trId} ({item.name}): {item.error}</Text>
                    ))}
                    {migrationReport.failed.length > 20 && (
                      <Text>...and {migrationReport.failed.length - 20} more. Check error log for full list.</Text>
                    )}
                  </Stack>
                )}

                {migrationReport.skipped && migrationReport.skipped.filter(s => !s.reason.includes('dry run')).length > 0 && (
                  <Stack space="space.050">
                    <Text><Strong>Skipped items (already existed):</Strong></Text>
                    {migrationReport.skipped.filter(s => !s.reason.includes('dry run')).slice(0, 10).map((item, i) => (
                      <Text key={i}>{item.entity} ID {item.trId}: {item.reason}</Text>
                    ))}
                  </Stack>
                )}
              </Stack>
            )}

            {/* Buttons (UPDATED) */}
            <Inline space="space.100">
              <Button onClick={() => { setStep(3); setMigrationDone(false); setProgress(null); }}>
                Back
              </Button>
              <Button
                appearance="warning"
                onClick={checkStorageAndConfirmClear}
                isDisabled={loading || clearing}
              >
                {clearing ? 'Checking...' : 'Clear Stored Data'}
              </Button>
              {!migrationDone && (
                <Button
                  appearance="primary"
                  onClick={() => startMigration(false)}
                  isDisabled={loading || clearing}
                >
                  {loading ? 'Running...' : dryRun ? 'Run Dry Run' : 'Start Live Migration'}
                </Button>
              )}
              {migrationDone && migrationReport && migrationReport.failed.length > 0 && (
                <Button
                  appearance="primary"
                  onClick={() => startMigration(true)}
                  isDisabled={loading}
                >
                  Retry Failed Items ({migrationReport.failed.length})
                </Button>
              )}
              {migrationDone && (
                <Button
                  onClick={() => {
                    setStep(0);
                    setMigrationDone(false);
                    setProgress(null);
                    setMigrationError('');
                    setMappingLoaded(false);
                    setMigrationReport(null);
                  }}
                >
                  Start New Migration
                </Button>
              )}
            </Inline>
          </Stack>
        )}

      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

