const fs = require('fs');
const path = require('path');
const ts = require('typescript');

function requireProductionTsModule(relativePath) {
  const filename = path.resolve(__dirname, '..', relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (request.startsWith('./') || request.startsWith('../')) {
      const resolved = path.resolve(path.dirname(filename), request);
      try { return require(resolved); } catch (_) { return {}; }
    }
    return require(request);
  };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(localRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

const {
  createTransportStatusController,
  buildAdvanceTowRequestStatusPayload,
  buildTransportStatusContext,
  canConfirmTransportStatusUpdate,
} = requireProductionTsModule('lib/transportLifecycleLogic.ts');

function assert(condition, label) {
  if (!condition) throw new Error(label);
  console.log(`PASS ${label}`);
}

function flushAsyncWork() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function createHarness(initialContext, advanceImpl = async () => ({ error: null })) {
  let loading = false;
  const alerts = [];
  const rpcCalls = [];
  const stateUpdates = [];
  const refs = {
    submission: false,
    confirmationId: 1,
    pending: null,
    current: initialContext ? { ...initialContext } : null,
  };

  const controller = createTransportStatusController({
    getCurrentContext: () => refs.current,
    getCurrentConfirmationId: () => refs.confirmationId,
    getPendingConfirmation: () => refs.pending,
    setPendingConfirmation: (value) => { refs.pending = value; },
    getSubmissionLocked: () => refs.submission,
    setSubmissionLocked: (value) => { refs.submission = value; },
    getLoading: () => loading,
    setLoading: (value) => { loading = value; },
    advanceStatus: async (payload) => {
      rpcCalls.push({ name: 'advance_tow_request_status', args: payload });
      return advanceImpl(payload);
    },
    applyOptimisticStatus: () => stateUpdates.push('optimistic'),
    refreshAfterStatusUpdate: async () => stateUpdates.push('refresh'),
    onError: () => alerts.push(['Chyba']),
    onNotDriver: () => alerts.push(['RoadLink', 'Stav přepravy může měnit pouze vybraný přepravce.']),
    showConfirmation: (nextStatus, clearConfirmation, submitConfirmation) => {
      alerts.push([
        nextStatus === 'in_progress' ? 'Zahájit přepravu?' : 'Dokončit přepravu?',
        nextStatus,
        [
          { text: 'Zpět', onPress: clearConfirmation },
          { text: nextStatus === 'in_progress' ? 'Zahájit přepravu' : 'Potvrdit doručení', onPress: submitConfirmation },
        ],
        { onDismiss: clearConfirmation },
      ]);
    },
  });

  function lastDialog() { return alerts[alerts.length - 1]; }
  function invalidateContext(nextContext = refs.current) {
    refs.current = nextContext ? { ...nextContext } : null;
    refs.confirmationId += 1;
    if (refs.pending) {
      refs.pending.used = true;
      refs.pending = null;
    }
  }

  return { ...controller, alerts, rpcCalls, stateUpdates, lastDialog, invalidateContext, refs };
}

const startContext = { requestId: 'r1', userId: 'driver1', screen: 'tracking', status: 'offer_selected', driverId: 'driver1' };
const doneContext = { requestId: 'r1', userId: 'driver1', screen: 'tracking', status: 'in_progress', driverId: 'driver1' };

(async () => {
  assert(buildTransportStatusContext({ activeJobId: 'r1', activeJob: { id: 'r1', status: 'offer_selected' }, userId: 'driver1', screen: 'tracking', selectedOffer: { driver_id: 'driver1' } }).driverId === 'driver1', '0 production context builder maps active job/offer/user');
  assert(buildAdvanceTowRequestStatusPayload(startContext, 'in_progress').p_tow_request_id === 'r1', '0 production payload maps request id');
  assert(canConfirmTransportStatusUpdate({ ...startContext, driverId: 'other' }, 'in_progress', false, false, false).reason === 'not_driver', '0 ownership guard blocks non-driver status update');

  let h = createHarness(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  assert(h.rpcCalls.length === 0, '1 open without confirm = 0 RPC calls');

  h = createHarness(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  const cancelledConfirm = h.lastDialog()[2][1].onPress;
  h.lastDialog()[2][0].onPress();
  await cancelledConfirm();
  assert(h.rpcCalls.length === 0, '2 cancel then old confirm callback = 0 RPC calls');

  h = createHarness(startContext);
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
    h = createHarness(startContext);
    h.confirmTransportStatusUpdate('in_progress');
    const confirm = h.lastDialog()[2][1].onPress;
    h.refs.current = nextContext;
    await confirm();
    assert(h.rpcCalls.length === 0, `3 stale ${field} context = 0 RPC calls`);
  }

  h = createHarness(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  const oldConfirmAfterNavigation = h.lastDialog()[2][1].onPress;
  h.invalidateContext(null);
  h.invalidateContext(startContext);
  await oldConfirmAfterNavigation();
  assert(h.rpcCalls.length === 0, '4 leave detail and return invalidates old confirmation');

  h = createHarness(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  const doubleConfirm = h.lastDialog()[2][1].onPress;
  await Promise.all([doubleConfirm(), doubleConfirm()]);
  assert(h.rpcCalls.length === 1, '5 two immediate confirm callbacks = exactly 1 RPC call');

  let resolveRpc;
  h = createHarness(startContext, () => new Promise((resolve) => { resolveRpc = resolve; }));
  h.confirmTransportStatusUpdate('in_progress');
  const runningConfirm = h.lastDialog()[2][1].onPress;
  const running = runningConfirm();
  h.confirmTransportStatusUpdate('in_progress');
  const maybeSecondDialog = h.alerts.length > 1 ? h.lastDialog() : null;
  if (maybeSecondDialog) await maybeSecondDialog[2][1].onPress();
  assert(h.rpcCalls.length === 1, '6 while first request runs no second RPC starts');
  resolveRpc({ error: null });
  await running;

  h = createHarness(startContext, async () => h.rpcCalls.length === 1 ? { error: { message: 'fail' } } : { error: null });
  h.confirmTransportStatusUpdate('in_progress');
  await h.lastDialog()[2][1].onPress();
  await flushAsyncWork();
  h.confirmTransportStatusUpdate('in_progress');
  await h.lastDialog()[2][1].onPress();
  await flushAsyncWork();
  assert(h.rpcCalls.length === 2, '7 after request error a new dialog can submit again');

  h = createHarness(startContext);
  h.confirmTransportStatusUpdate('in_progress');
  await h.lastDialog()[2][1].onPress();
  assert(h.rpcCalls[0].args.p_tow_request_id === 'r1' && h.rpcCalls[0].args.p_expected_status === 'offer_selected' && h.rpcCalls[0].args.p_next_status === 'in_progress', '8 valid start confirm sends correct id/status transition');
  h = createHarness(doneContext);
  h.confirmTransportStatusUpdate('completed');
  await h.lastDialog()[2][1].onPress();
  assert(h.rpcCalls[0].args.p_tow_request_id === 'r1' && h.rpcCalls[0].args.p_expected_status === 'in_progress' && h.rpcCalls[0].args.p_next_status === 'completed', '8 valid complete confirm sends correct id/status transition');

  h = createHarness(startContext);
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
