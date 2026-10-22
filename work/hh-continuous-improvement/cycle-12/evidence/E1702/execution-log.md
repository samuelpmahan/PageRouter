# E1702 H2 probe execution log

All four executions used the same prospective command:

```sh
node /workspace/scratch/8528bb251845/hh-cycle12/H2/E1702/probe.mjs
```

The command runner exposed a combined `output` field; it did not separately identify stdout versus stderr. The probe intentionally emits only sanitized status/count/boolean results and failure codes. No credentials or synthetic email addresses were printed.

| Attempt | Exit | Combined output | Harness note |
|---|---:|---|---|
| 1 | 1 | `{"status":"failed","errorCode":"initial_render_matches"}` | Harness queried `profile-name` instead of actual `hh-profile-name` IDs. |
| 2 | 1 | `{"status":"failed","errorCode":"profile_overlay_matches_current_input"}` | Harness compared the dedicated success-only scenario against the held-failure scenario's live draft. |
| 3 | 1 | `{"status":"failed","errorCode":"profile_overlay_name_mismatch"}` | Same expected-value harness bug remained after the diagnostic split. |
| 4 | 0 | `{"status":"passed","results":[{"label":"known","expectedFailure":true,"resultOk":false,"errorCode":"transport_failure","providerAbsentAfterAttempt":true,"oneProviderCall":true,"oneReceipt":true,"twoParts":true,"noStorageWrite":true,"storedStateUnchanged":true,"retainedForm":true,"retryDisabled":true,"retryDidNotCallProvider":true,"explicitResubmitUsesDraft":true,"finalProfileOverlayMatches":true,"overlayNameMatches":true,"overlayBioMatches":true,"overlayWishlistMatches":true,"finalProviderPresent":true,"finalProviderCalls":2,"finalReceiptDelta":2,"finalPartDelta":4,"successStorageWriteDeltaIsOne":null,"finalCreateDraftCleared":true,"finalFormClosed":true},{"label":"unknown","expectedFailure":true,"resultOk":false,"errorCode":"outcome_unknown","providerAbsentAfterAttempt":true,"oneProviderCall":true,"oneReceipt":true,"twoParts":true,"noStorageWrite":true,"storedStateUnchanged":true,"retainedForm":true,"retryDisabled":true,"retryDidNotCallProvider":true,"explicitResubmitUsesDraft":true,"finalProfileOverlayMatches":true,"overlayNameMatches":true,"overlayBioMatches":true,"overlayWishlistMatches":true,"finalProviderPresent":true,"finalProviderCalls":2,"finalReceiptDelta":2,"finalPartDelta":4,"successStorageWriteDeltaIsOne":null,"finalCreateDraftCleared":true,"finalFormClosed":true},{"label":"success","expectedFailure":false,"resultOk":true,"errorCode":null,"providerAbsentAfterAttempt":false,"oneProviderCall":true,"oneReceipt":true,"twoParts":true,"noStorageWrite":false,"storedStateUnchanged":false,"retainedForm":true,"retryDisabled":false,"retryDidNotCallProvider":false,"explicitResubmitUsesDraft":null,"finalProfileOverlayMatches":true,"overlayNameMatches":true,"overlayBioMatches":true,"overlayWishlistMatches":true,"finalProviderPresent":true,"finalProviderCalls":1,"finalReceiptDelta":1,"finalPartDelta":2,"successStorageWriteDeltaIsOne":true,"finalCreateDraftCleared":true,"finalFormClosed":true}]}` | Probe passed known failure, unknown outcome, explicit fresh submission following each failure, and isolated direct success. |

No probe ran against backend/network/real account. The only modified/created files are under this E1702 scratch folder; PageRouter source and Git were not modified or queried.
