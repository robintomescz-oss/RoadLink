const fs = require('fs');
const path = require('path');

const appPath = path.resolve(__dirname, '..', 'App.tsx');
const source = fs.readFileSync(appPath, 'utf8');

function findFunctionBodyOpen(name) {
  const plain = source.indexOf(`function ${name}`);
  const asyncStart = source.indexOf(`async function ${name}`);
  const start = asyncStart >= 0 && (plain < 0 || asyncStart < plain) ? asyncStart : plain;
  if (start < 0) throw new Error(`Missing function ${name}`);
  let parenDepth = 0;
  let inParams = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '(') { parenDepth += 1; inParams = true; continue; }
    if (ch === ')') { parenDepth -= 1; continue; }
    if (inParams && parenDepth === 0 && ch === '{') return i;
  }
  throw new Error(`Missing body for ${name}`);
}

function extractBody(name) {
  const open = findFunctionBodyOpen(name);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    if (ch === '}') depth -= 1;
    if (depth === 0) return source.slice(open + 1, i);
  }
  throw new Error(`Unclosed body for ${name}`);
}

const updateBody = extractBody('updateTransportStatus');
const confirmBody = extractBody('confirmTransportStatusUpdate');

function assertSourceContains(label, text) {
  if (!source.includes(text)) throw new Error(`Source assertion failed: ${label}`);
}

assertSourceContains('current-context ref is used', 'transportStatusCurrentContextRef.current');
assertSourceContains('synchronous submission lock exists', 'transportStatusSubmissionRef.current = true');
assertSourceContains('one-shot used flag exists', 'confirmationContext.used = true');
assertSourceContains('context invalidation effect increments id', 'transportStatusConfirmationIdRef.current += 1');
assertSourceContains('old context cannot clear newer confirmation', 'transportStatusConfirmationRef.current === confirmationContext');

async function createHarness(initialContext, rpcImpl = async () => ({ error: null })) {
  let transportStatusLoading = false;
  const alerts = [];
  const rpcCalls = [];
  const stateUpdates = [];
  const transportStatusSubmissionRef = { current: false };
  const transportStatusConfirmationIdRef = { current: 1 };
  const transportStatusConfirmationRef = { current: null };
  const transportStatusCurrentContextRef = { current: initialContext ? { ...initialContext } : null };
  const Alert = { alert: (...args) => alerts.push(args) };
  const supabase = {
    rpc: async (name, args) => {
      rpcCalls.push({ name, args });
      return rpcImpl(name, args);
    },
  };
  const setTransportStatusLoading = (value) => { transportStatusLoading = value; };
  const setJobs = (fn) => { stateUpdates.push('jobs'); if (typeof fn === 'function') fn([]); };
  const setCustomerRequests = (fn) => { stateUpdates.push('customerRequests'); if (typeof fn === 'function') fn([]); };
  const setAcceptedJobs = (fn) => { stateUpdates.push('acceptedJobs'); if (typeof fn === 'function') fn([]); };
  const loadJobs = async () => { stateUpdates.push('loadJobs'); };
  const loadAcceptedJobs = async () => { stateUpdates.push('loadAcceptedJobs'); };
  const loadCustomerRequests = async () => { stateUpdates.push('loadCustomerRequests'); };
  const loadOffers = async () => { stateUpdates.push('loadOffers'); };
  const console = { error: () => {} };
  const factory = new Function(
    'Alert', 'supabase', 'console',
    'transportStatusSubmissionRef', 'transportStatusConfirmationIdRef', 'transportStatusConfirmationRef', 'transportStatusCurrentContextRef',
    'getTransportStatusLoading', 'setTransportStatusLoading', 'setJobs', 'setCustomerRequests', 'setAcceptedJobs',
    'loadJobs', 'loadAcceptedJobs', 'loadCustomerRequests', 'loadOffers',
    `let transportStatusLoading = getTransportStatusLoading();\n` +
    `async function updateTransportStatus(confirmationContext) {${updateBody}}\n` +
    `function confirmTransportStatusUpdate(nextStatus) {${confirmBody}}\n` +
    `return { updateTransportStatus, confirmTransportStatusUpdate };`
  );
  const api = factory(
    Alert, supabase, console,
    transportStatusSubmissionRef, transportStatusConfirmationIdRef, transportStatusConfirmationRef, transportStatusCurrentContextRef,
    () => transportStatusLoading, setTransportStatusLoading, setJobs, setCustomerRequests, setAcceptedJobs,
    loadJobs, loadAcceptedJobs, loadCustomerRequests, loadOffers
  );
  function lastDialog() { return alerts[alerts.length - 1]; }
  function invalidateContext(nextContext = transportStatusCurrentContextRef.current) {
    transportStatusCurrentContextRef.current = nextContext ? { ...nextContext } : null;
    transportStatusConfirmationIdRef.current += 1;
    if (transportStatusConfirmationRef.current) {
      transportStatusConfirmationRef.current.used = true;
      transportStatusConfirmationRef.current = null;
    }
  }
  return { ...api, alerts, rpcCalls, stateUpdates, lastDialog, invalidateContext, refs: { transportStatusSubmissionRef, transportStatusConfirmationIdRef, transportStatusConfirmationRef, transportStatusCurrentContextRef } };
}

const startContext = { requestId: 'r1', userId: 'driver1', screen: 'tracking', status: 'offer_selected', driverId: 'driver1' };
const doneContext = { requestId: 'r1', userId: 'driver1', screen: 'tracking', status: 'in_progress', driverId: 'driver1' };

function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`PASS ${label}`);
}

function flushAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

(async () => {
  let h = await createHarness(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  assert(h.rpcCalls.length === 0, '1 open without confirm = 0 RPC calls');

  h = await createHarness(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  const cancelledConfirm = h.lastDialog()[2][1].onPress;
  h.lastDialog()[2][0].onPress();
  await cancelledConfirm();
  assert(h.rpcCalls.length === 0, '2 cancel then old confirm callback = 0 RPC calls');

  h = await createHarness(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  const dismissedConfirm = h.lastDialog()[2][1].onPress;
  h.lastDialog()[3].onDismiss();
  await dismissedConfirm();
  assert(h.rpcCalls.length === 0, '2 system dismiss then old confirm callback = 0 RPC calls');

  for (const [field, nextContext] of [
    ['account', { ...startContext, userId: 'driver2' }],
    ['request', { ...startContext, requestId: 'r2' }],
    ['status', { ...startContext, status: 'in_progress' }],
    ['driver', { ...startContext, driverId: 'driver2' }],
  ]) {
    h = await createHarness(startContext);
    h.confirmTransportStatusUpdate('in_progress');
    const confirm = h.lastDialog()[2][1].onPress;
    h.refs.transportStatusCurrentContextRef.current = nextContext;
    await confirm();
    assert(h.rpcCalls.length === 0, `3 stale ${field} context = 0 RPC calls`);
  }

  h = await createHarness(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  const oldConfirmAfterNavigation = h.lastDialog()[2][1].onPress;
  h.invalidateContext(null);
  h.invalidateContext(startContext);
  await oldConfirmAfterNavigation();
  assert(h.rpcCalls.length === 0, '4 leave detail and return invalidates old confirmation');

  h = await createHarness(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  const doubleConfirm = h.lastDialog()[2][1].onPress;
  await Promise.all([doubleConfirm(), doubleConfirm()]);
  assert(h.rpcCalls.length === 1, '5 two immediate confirm callbacks = exactly 1 RPC call');

  let resolveRpc;
  h = await createHarness(startContext, () => new Promise((resolve) => { resolveRpc = resolve; }));
  h.confirmTransportStatusUpdate('in_progress');
  const runningConfirm = h.lastDialog()[2][1].onPress;
  const running = runningConfirm();
  h.confirmTransportStatusUpdate('in_progress');
  const maybeSecondDialog = h.alerts.length > 1 ? h.lastDialog() : null;
  if (maybeSecondDialog) await maybeSecondDialog[2][1].onPress();
  assert(h.rpcCalls.length === 1, '6 while first request runs no second RPC starts');
  resolveRpc({ error: null });
  await running;

  h = await createHarness(startContext, async () => h.rpcCalls.length === 1 ? { error: { message: 'fail' } } : { error: null });
  h.confirmTransportStatusUpdate('in_progress');
  await h.lastDialog()[2][1].onPress();
  await flushAsyncWork();
  h.confirmTransportStatusUpdate('in_progress');
  await h.lastDialog()[2][1].onPress();
  await flushAsyncWork();
  assert(h.rpcCalls.length === 2, '7 after request error a new dialog can submit again');

  h = await createHarness(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  await h.lastDialog()[2][1].onPress();
  assert(h.rpcCalls[0].args.p_tow_request_id === 'r1' && h.rpcCalls[0].args.p_expected_status === 'offer_selected' && h.rpcCalls[0].args.p_next_status === 'in_progress', '8 valid start confirm sends correct id/status transition');
  h = await createHarness(doneContext);
  h.confirmTransportStatusUpdate('completed');
  await h.lastDialog()[2][1].onPress();
  assert(h.rpcCalls[0].args.p_tow_request_id === 'r1' && h.rpcCalls[0].args.p_expected_status === 'in_progress' && h.rpcCalls[0].args.p_next_status === 'completed', '8 valid complete confirm sends correct id/status transition');

  h = await createHarness(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  const staleCancel = h.lastDialog()[2][0].onPress;
  h.invalidateContext(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  staleCancel();
  await h.lastDialog()[2][1].onPress();
  assert(h.rpcCalls.length === 1, '9 stale cancel callback does not clear newer dialog');

  console.log('ALL TRANSPORT CONFIRMATION REGRESSION TESTS PASSED');
})().catch((error) => {
  console.error(error.stack || error.message || error);
  process.exit(1);
});
