# Usability improvement implementation record

This record tracks the 37-item product audit against the local implementation. An item with remaining work is not complete.

| Audit item | Implemented | Remaining work |
| --- | --- | --- |
| 1. Mobile set saving | Save, discard and saved state in Setlist | Production refresh acceptance |
| 2. Chart-first Perform | Setup collapsed, more chart space | More device sizes |
| 3. Contrast and targets | Dark selection foreground and 44 px transport controls | Full accessibility audit |
| 4. Output names | Split, mono and click-off labels describe routing and cue behavior | None |
| 5. Custom loops | Both endpoints required, whole-song action separate | None |
| 6. Import navigation | Cancel returns to Library; import no longer automatically adds to set | Explicit review/back completion screen |
| 7. First action | Existing empty state retained | Guided owner/member onboarding |
| 8. Import choices | Mobile file chooser language | Recording/stems/chart entry chooser and stem assignment review |
| 9. Library readiness | Timing-review and processing filters | Separate chart approval field in catalog and next-action links |
| 10. Search | Query retained, clear search, filters, sort loaded rows, failure notification | Inline retry/loading and server-wide sorting |
| 11. Setlist editing | Duplicate, undo removal, save/discard and reload warning | Move to position, conflict reconciliation |
| 12. Batch recovery | Existing sequential retry and pause retained | Durable reload recovery and failed-row summary |
| 13. Processor status | Existing queue and desktop states retained | Unified model download and queue status |
| 14. Reprocessing | Confirmation lists outputs and replacement effect | Mix mapping, A/B comparison and prior audio restore |
| 15. Timing workflow | Existing timing tools retained | Unified timing workspace |
| 16. Waveform | Existing decoded waveform retained | Stored peak generation and streamed waveform |
| 17. Chart actions | Explicit Play from here controls; ordinary rows no longer button containers | Dedicated chart edit mode |
| 18. Chart imports | Section-targeted import, preserve other instruments, previous chart restore in current view | Durable chart history and before/after diff |
| 19. Provenance | Existing approval and draft states retained | Per-section confidence and reason approval became stale |
| 20. Personal/shared scope | Mixer headings name device and shared scopes | Scope presentation across every preference |
| 21. Practice | Valid endpoints and whole-song loop | Inline section loop and saved-loop update/rename |
| 22. Session from set | Start rehearsal action on Setlist | QR code and additional review summary |
| 23. Join roles | Discovered sessions open role chooser; visible role and scoped Stop label | Physical PA role check |
| 24. Readiness | Devices needing attention first; blocker reminder near playback | Named first blocker and grouped statuses |
| 25. Sound tests | Separate left/right checks and stop-test action | Physical cable and output check |
| 26. Recovery | Persistent reconnect message and accurate offline explanation | Pack expiry countdown |
| 27. Cues | Next section/Next song labels and Stand by when stopped | Tuning-change emphasis |
| 28. Stage layout | Compact stage header, bigger controls, opt-in wake lock | Landscape/tablet and output interruption acceptance |
| 29. Visual hierarchy | Chart-first stage and compact setup | Library hierarchy and placeholder-art cleanup |
| 30. Shared styles | Interaction tokens and consistent focus/reduced-motion rules | Consolidate historical stylesheet overrides |
| 31. Text sizes | Independent settings retained in collapsed Stage setup | Tab fit-to-width and maximum-scale QA |
| 32. Keyboard | Settings focus containment and Escape, explicit chart seek buttons | Complete keyboard/screen-reader acceptance |
| 33. Band ownership | Existing secure pairing retained | Member display names and role descriptions |
| 34. Downloads | Missing platform asset has explicit unavailable state | Verified server manifest with fallback |
| 35. Setup guide | Root identifies maintained app and legacy kit | Consolidated user guide and provider restore exercise |
| 36. Demo/testing | Import config injected; demo no longer hits real config endpoint; sound routing regression test | Browser tests in CI |
| 37. Physical rehearsal | Existing automated audio tests retained | Laptop, phones, PA and network interruption rehearsal |

## Verification

Phone viewport walkthrough at 390 × 844 verified Save changes, chart visibility, 44 px transport targets, dark preset colors, disabled unmarked A–B practice, and canceling import back to Library. Sample data and a demo adapter were used. Physical PA, separate phone outputs, production upload recovery and provider restore require their real environments.

## Physical acceptance procedure

Use a leader laptop, two phones and a dedicated audience device connected to a mixer. Prepare the same saved set on each device. Test music left and click/cues right before connecting the audience output. Join the audience role and verify both generated and recorded click/cues are excluded. Start, stop, seek and advance a song. Compare audible timing using a recording of the outputs. Interrupt the network, wait beyond 30 seconds and verify local pause and explicit recovery. Repeat after locking a phone, changing output hardware and returning from the background. Record device models, operating systems, browsers, audible skew and failures.
