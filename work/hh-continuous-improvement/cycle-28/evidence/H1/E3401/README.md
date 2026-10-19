# E3401 evidence checkpoint

## Question

Does a safe, retryable `SchoolData` cascade failure initiated from the public
directory expose a rendered recovery action, or only controller-level retry?

## Planned flow (before execution)

1. Import the checked-out `checkpoint/vendor/hh` fixture provider, runtime,
   community module, public controller, and public renderer directly.
2. Use `createFixtureProvider({fixture:true, storage:null})` and volatile local
   controller state; initialize `#/directory` and retain the exact rendered
   tree from `onChange`.
3. Dispatch `public:fail-next`, select `state = "Demo Washington"`, then inspect
   `lookupError`, `lookupRetryable`, `matches.status`, `canRetry`, rendered
   status text, and rendered `public:retry` controls.
4. Dispatch one explicit `public:retry` to establish whether the latent
   controller capability succeeds; inspect resulting choices and controls.

The probe performs fixture-only reads and in-memory state changes. It does not
start a server/browser, contact an origin, use a real account, or write
persistent/browser storage. No repository source is edited.

## Source pins

Repository: `/workspace/scratch/86659bbafcce/PageRouter`

Commit and tree are captured with each run in `baseline.json` and `run.json`.
