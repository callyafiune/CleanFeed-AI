# Task 18 report — complete worker pipeline and cancellation protocol

## Scope

Implemented the Task 18 worker-facing pipeline only:

- discriminated worker protocol messages (`INITIALIZE`, `CLASSIFY`, `CANCEL`, `STATUS`, `DISPOSE`);
- request-scoped settings snapshots passed from background through offscreen to the worker;
- `PipelineRunner` ordering language detection → policy → tokenization → chunks → per-chunk inference → aggregation → calibration → explanation;
- request-ID cancellation and timeout settlement in `WorkerHost`;
- recoverable timeout result (`classification_failed`, `INFERENCE_TIMEOUT`);
- integration coverage for pipeline completion, batching capability, cancellation, and timeout.

## TDD evidence

### RED

Command:

```powershell
npm test -- --run tests/integration/inference-pipeline.test.ts tests/integration/cancellation-timeout.test.ts
```

Observed four expected failures before implementation:

- `PipelineRunner is not a constructor` (two tests);
- `host.cancel is not a function`;
- timeout test exceeded Vitest's five-second limit because the host did not settle timed-out work.

### GREEN

The same focused command passed after the minimal implementation:

```text
Test Files  2 passed (2)
Tests       4 passed (4)
```

## Files

- `src/inference/worker-protocol.ts`
- `src/inference/inference-worker.ts`
- `src/offscreen/worker-host.ts`
- `src/background/message-router.ts`
- `tests/integration/inference-pipeline.test.ts`
- `tests/integration/cancellation-timeout.test.ts`

## Verification

```text
npm test -- --run                         37 passed / 254 passed
npm run typecheck                         pass
npm run lint                              pass (0 errors; 2 pre-existing React Fast Refresh warnings)
npm run format:check                      pass
npm run build                             pass
git diff --check                          pass
```

## Commit

Committed with the required message: `feat: run the complete local inference pipeline`.

## Concerns

- The two lint warnings are pre-existing in `src/options/App.tsx` and `src/popup/App.tsx`; they are outside Task 18 scope.
- Compatibility for legacy direct worker messages without a settings snapshot remains deliberately supported using the existing defaults with `experimental_any`; normal background-routed requests now always carry a per-request snapshot and the worker never reads storage.

## Review-fix follow-up

After integration review, added regression coverage and implementation for the production settings-snapshot validation, best-effort cancellation when the worker has already closed, language-policy abstention, and batching-window host scheduling.

- `OFFSCREEN_CLASSIFY` now requires and validates a complete settings snapshot in the canonical extension-message validator.
- `CANCEL_CLASSIFICATION` is permitted from background to offscreen; the router relays it through `RuntimeOffscreenClient`, and the offscreen listener calls `WorkerHost.cancel`.
- The host settles cancellation or timeout before attempting the best-effort worker `CANCEL` post.
- Language-policy denial produces a typed `insufficient_evidence` result with decision and explanation rather than an abort/cancel response.
- Pipeline results carry real stage durations for language, tokenization, chunking, inference, aggregation, and calibration.
- When explicitly configured with classifier batching capability, the host holds batching-enabled work for a 10 ms window and drains at most eight requests per window.

Follow-up verification: focused 55 tests pass; full suite passes 258/258; typecheck, formatting, and build pass. Lint has the same two pre-existing Fast Refresh warnings and no errors.

## Final batching and lifecycle follow-up

- Compatible requests now become one `CLASSIFY` worker command whose payload contains at most eight request envelopes. The worker maps that command to one cross-request `PipelineRunner.classifyBatch` invocation and returns a result by original request ID.
- Compatibility requires the same platform and serialized settings snapshot; batching is enabled only when both the request setting and the host's classifier-capability flag are true.
- `WorkerHost` now emits `INITIALIZE`, `STATUS`, and `DISPOSE` controls. The offscreen document initializes the worker at startup; disposal sends its protocol control before termination.
- Added focused regressions for one host-level combined batch command and lifecycle controls.

Final verification: full suite 259/259; typecheck, formatter, and build pass.

## Post-`596f533` verification

```powershell
npm test -- --run
# Test Files  37 passed (37)
# Tests       260 passed (260)

npm run typecheck
# exit 0

npm run lint
# exit 0; 0 errors, 2 pre-existing react-refresh warnings

npm run format:check
# All matched files use Prettier code style!

npm run build
# ✓ built in 209ms
```

## Batch isolation follow-up

Batch preparation now returns a typed language-policy abstention per denied request, so it does not poison a batch. Batch worker cancellation uses per-request controllers and does not pass an item signal into a multi-request classifier call; a cancellation response is therefore scoped to its ID while siblings continue to receive results. Worker status includes the classifier batching capability and the host updates its scheduling capability from that handshake.

The batch worker now registers a distinct controller for each request ID and keeps multi-request classifier calls independent of any one item signal; outer batch errors are emitted for every original request ID. `PipelineRunner.classifyBatch` partitions prepared requests by detected language before invoking the classifier, with focused mixed-language coverage asserting separate `pt` and `und` options.

## Final verification after `4fcfa81`

```powershell
npm test -- --run
# Test Files  37 passed (37)
# Tests       259 passed (259)

npm run typecheck
# tsc --noEmit && tsc --noEmit --project tsconfig.node.json
# exit 0

npm run lint
# exit 0; 0 errors, 2 pre-existing react-refresh/only-export-components warnings

npm run format:check
# All matched files use Prettier code style!

npm run build
# vite build
# ✓ built in 309ms
```
