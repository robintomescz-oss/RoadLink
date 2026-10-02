const assert = require('assert');
const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');

function loadTsModule(relativePath, stubs = {}) {
  const filename = path.join(root, relativePath);
  const source = fs.readFileSync(filename, 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const localRequire = (request) => {
    if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
    if (request.startsWith('./') || request.startsWith('../')) {
      const resolved = path.resolve(path.dirname(filename), request);
      const asTs = `${resolved}.ts`;
      if (fs.existsSync(asTs)) return loadTsModule(path.relative(root, asTs), stubs);
      try { return require(resolved); } catch (_) { return {}; }
    }
    return require(request);
  };
  Function('require', 'module', 'exports', '__filename', '__dirname', output)(localRequire, module, module.exports, filename, path.dirname(filename));
  return module.exports;
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

async function runTest() {
  // Stub supabase to avoid loading real supabase when loading routeMetrics (which is imported by preview logic)
  const supabaseStub = {
    functions: {
      invoke: async () => ({ data: null, error: null })
    }
  };

  const preview = loadTsModule('lib/routeMetricsPreviewLogic.ts', { './supabase': supabaseStub });
  const forms = loadTsModule('lib/createFormLogic.ts', {
    './publicMarket': loadTsModule('lib/publicMarket.ts'),
    './supabase': supabaseStub,
  });

  assert.strictEqual(preview.formatRouteDistanceKm(205432), '205 km');
  assert.strictEqual(preview.formatRouteDuration(45 * 60), '45 min');
  assert.strictEqual(preview.formatRouteDuration(125 * 60), '2 h 5 min');

  const calls = [];
  const pending = [];
  const logged = [];
  const controller = preview.createRouteMetricsPreviewController({
    fetchRouteMetrics: (input) => {
      calls.push({ ...input });
      const next = deferred();
      pending.push(next);
      return next.promise;
    },
    onChange: () => {},
    logger: { log: (...args) => logged.push(args), warn: (...args) => logged.push(args), error: (...args) => logged.push(args) },
  });

  controller.update({ originPlaceId: null, destinationPlaceId: 'dest-1' });
  assert.strictEqual(calls.length, 0, 'no route call without origin');
  assert.strictEqual(controller.getSnapshot().status, 'idle');

  controller.update({ originPlaceId: 'origin-1', destinationPlaceId: null });
  assert.strictEqual(calls.length, 0, 'no route call without destination');
  assert.strictEqual(controller.getSnapshot().status, 'idle');

  controller.update({ originPlaceId: 'origin-1', destinationPlaceId: 'dest-1' });
  assert.strictEqual(calls.length, 1, 'valid pair triggers exactly one automatic route call');
  assert.strictEqual(controller.getSnapshot().status, 'loading');

  controller.update({ originPlaceId: 'origin-1', destinationPlaceId: 'dest-1' });
  assert.strictEqual(calls.length, 1, 'rerender with same pair does not trigger another automatic route call');

  const first = pending[0];
  controller.update({ originPlaceId: 'origin-2', destinationPlaceId: 'dest-1' });
  assert.strictEqual(calls.length, 2, 'changing one place ID starts one request for the new pair');
  assert.strictEqual(controller.getSnapshot().status, 'loading');
  assert.strictEqual(controller.getSnapshot().metrics, null, 'changing a place ID invalidates old metrics immediately');

  first.resolve({ ok: true, metrics: { distanceMeters: 1000, durationSeconds: 60 } });
  await flush();
  assert.strictEqual(controller.getSnapshot().status, 'loading', 'stale response cannot overwrite newer pair state');

  pending[1].resolve({ ok: true, metrics: { distanceMeters: 205432, durationSeconds: 7500 } });
  await flush();
  assert.strictEqual(controller.getSnapshot().status, 'success');
  assert.deepStrictEqual(controller.getSnapshot().metrics, { distanceMeters: 205432, durationSeconds: 7500 });
  assert.strictEqual(controller.getSnapshot().readyToSubmit, true, 'success metrics are ready to submit');

  controller.update({ originPlaceId: 'origin-err', destinationPlaceId: 'dest-err' });
  pending[2].resolve({ ok: false, code: 'rate_limited', message: 'server details hidden', retryAfterSeconds: 37 });
  await flush();
  assert.strictEqual(controller.getSnapshot().status, 'rate_limited', '429/rate limit maps to safe rate_limited state');
  assert.strictEqual(controller.getSnapshot().retryAfterSeconds, 37);
  assert.match(controller.getSnapshot().errorMessage || '', /chvíli|počkejte|vytížená/i, 'rate-limit text is safe and user-facing');

  // FIXED: store retry promise, verify the request was created, resolve it, then await retry.
  const retryPromise = controller.retry();
  assert.strictEqual(calls.length, 4, 'explicit retry creates exactly one new attempt before it is awaited');
  pending[3].resolve({ ok: false, code: 'unknown', message: 'raw upstream private text' });
  await retryPromise;
  await flush();
  assert.strictEqual(controller.getSnapshot().status, 'error', 'unexpected route failure maps to generic error');
  assert.doesNotMatch(controller.getSnapshot().errorMessage || '', /raw upstream private text/i, 'raw server error is not shown');

  const beforeReturnCalls = calls.length;
  controller.update({ originPlaceId: 'origin-2', destinationPlaceId: 'dest-1' });
  assert.strictEqual(controller.getSnapshot().status, 'success', 'returning to a successful earlier pair restores cached success');
  assert.deepStrictEqual(controller.getSnapshot().metrics, { distanceMeters: 205432, durationSeconds: 7500 }, 'cached metrics match the earlier successful pair');
  assert.strictEqual(calls.length, beforeReturnCalls, 'returning to a cached successful pair does not fetch again');

  controller.update({ originPlaceId: 'origin-err', destinationPlaceId: 'dest-err' });
  assert.strictEqual(calls.length, beforeReturnCalls + 1, 'returning to a failed earlier pair creates exactly one new automatic attempt');
  controller.update({ originPlaceId: 'origin-err', destinationPlaceId: 'dest-err' });
  assert.strictEqual(calls.length, beforeReturnCalls + 1, 'rerender of failed active pair does not auto-retry repeatedly');
  pending[4].resolve({ ok: true, metrics: { distanceMeters: 3333, durationSeconds: 222 } });
  await flush();
  assert.strictEqual(controller.getSnapshot().status, 'success', 'failed pair can recover after a new activation attempt');

  const unmountChanges = [];
  const unmountController = preview.createRouteMetricsPreviewController({
    fetchRouteMetrics: () => {
      const next = deferred();
      pending.push(next);
      return next.promise;
    },
    onChange: (snapshot) => unmountChanges.push(snapshot.status),
  });
  unmountController.update({ originPlaceId: 'unmount-origin', destinationPlaceId: 'unmount-dest' });
  assert.deepStrictEqual(unmountChanges, ['idle', 'loading'], 'unmount test starts one request');
  unmountController.cancelPendingResponses();
  pending[5].resolve({ ok: true, metrics: { distanceMeters: 9999, durationSeconds: 999 } });
  await flush();
  assert.deepStrictEqual(unmountChanges, ['idle', 'loading'], 'cancelled request completion does not emit a state update');

  const hookSource = fs.readFileSync(path.join(root, 'hooks/useRouteMetricsPreview.ts'), 'utf8');
  assert(hookSource.includes('mountedRef'), 'hook guards React state updates after unmount');

  const logDump = JSON.stringify(logged);
  assert(!logDump.includes('origin-') && !logDump.includes('dest-'), 'route preview does not log place IDs');

  const successPreview = {
    status: 'success',
    pairKey: 'pickup-1::dropoff-1',
    metrics: { distanceMeters: 205432, durationSeconds: 7500 },
    readyToSubmit: true,
  };
  assert.deepStrictEqual(forms.buildRouteMetricsPayload({ originPlaceId: 'pickup-1', destinationPlaceId: 'dropoff-1', preview: successPreview }), {
    origin_place_id: 'pickup-1',
    destination_place_id: 'dropoff-1',
    route_distance_meters: 205432,
    route_duration_seconds: 7500,
  }, 'payload contains all four route metric columns from the current pair');
  assert.strictEqual(forms.routeMetricsSubmitBlockReason({ originPlaceId: null, destinationPlaceId: 'dropoff-1', preview: successPreview }), 'Vyberte výchozí a cílové místo');
  assert.strictEqual(forms.routeMetricsSubmitBlockReason({ originPlaceId: 'pickup-1', destinationPlaceId: 'dropoff-1', preview: { ...successPreview, status: 'loading', readyToSubmit: false } }), 'Počítám trasu…');
  assert.strictEqual(forms.routeMetricsSubmitBlockReason({ originPlaceId: 'pickup-1', destinationPlaceId: 'dropoff-1', preview: { ...successPreview, pairKey: 'old::pair' } }), 'Nejprve je potřeba ověřit trasu');
  assert.strictEqual(forms.routeMetricsSubmitBlockReason({ originPlaceId: 'pickup-1', destinationPlaceId: 'dropoff-1', preview: successPreview }), null, 'valid current metrics allow submit');
  assert.throws(() => forms.buildRouteMetricsPayload({ originPlaceId: 'pickup-1', destinationPlaceId: 'dropoff-1', preview: { ...successPreview, pairKey: 'old::pair' } }), /current route metrics/i, 'stale metrics cannot build an insert payload');

  const createRequestSource = fs.readFileSync(path.join(root, 'screens/Transport/CreateRequestScreen.tsx'), 'utf8');
  const routeFormSource = fs.readFileSync(path.join(root, 'screens/Transport/RouteFormRoute.tsx'), 'utf8');
  for (const source of [createRequestSource, routeFormSource]) {
    assert(source.includes('buildRouteMetricsPayload'), 'form calls buildRouteMetricsPayload');
    assert(source.includes('...routeMetricsPayload'), 'form spreads route metrics payload');
    assert(source.includes('routeMetricsSubmitBlockReason'), 'form submit guard uses shared route metrics guard');
  }

  const publicMarketSource = fs.readFileSync(path.join(root, 'lib/publicMarket.ts'), 'utf8');
  assert(publicMarketSource.includes('\"origin_place_id\"') && publicMarketSource.includes('\"route_distance_meters\"'), 'public marketplace forbidden field list still blocks private route metrics');

  console.log('ROUTE PREVIEW REGRESSION PASSED');
}

runTest().catch((error) => {
  console.error(error);
  process.exit(1);
});