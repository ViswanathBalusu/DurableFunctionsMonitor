repo: ViswanathBalusu/DurableFunctionsMonitor
branch: main
path: durablefunctionsmonitor.react/src

## Last sync
date: 2026-09-05T01:02:38Z

### Updated in this project
- Read README, MainMenu, OrchestrationDetails, DurableOrchestrationStatus and ResultsListTabState to ground the new IA (runtime statuses, fields, actions, main-menu dialogs, auto-refresh options)
- Built the neo-brutalist rewrite mockup (shell + 10 screens, 5 themes × light/dark) from the attached design system and rewrite plan; the React MUI UI is intentionally not recreated

## Screen map
| Screen | Repo files |
|---|---|
| DFM App.dc.html (shell) | durablefunctionsmonitor.react/src/components/Main.tsx, MainMenu.tsx, states/MainState.ts, DfmContext.ts |
| ScreenLogin.dc.html | durablefunctionsmonitor.react/src/states/LoginState.ts, components/LoginIcon.tsx |
| ScreenInstances.dc.html | durablefunctionsmonitor.react/src/components/results-view/Orchestrations.tsx, OrchestrationsList.tsx, states/results-view/ResultsListTabState.ts, states/FilterOperatorEnum.ts, states/DurableOrchestrationStatus.ts |
| ScreenInstance.dc.html | durablefunctionsmonitor.react/src/components/details-view/OrchestrationDetails.tsx, OrchestrationButtons.tsx, OrchestrationFields.tsx, states/details-view/OrchestrationDetailsState.ts, GanttDiagramTabState.ts, SequenceDiagramTabState.ts, FunctionGraphTabState.ts |
| ScreenEntities.dc.html | durablefunctionsmonitor.react/src/components/details-view/DurableEntityButtons.tsx, DurableEntityFields.tsx, dialogs/CleanEntityStorageDialog.tsx |
| ScreenFunctions.dc.html | durablefunctionsmonitor.react/src/components/FunctionGraph.tsx, results-view/OrchestrationsFunctionGraph.tsx, states/FunctionGraphState.ts |
| ScreenSettings.dc.html | durablefunctionsmonitor.react/src/components/dialogs/PurgeHistoryDialog.tsx, ConnectionParamsDialog.tsx, StartNewInstanceDialog.tsx, BatchOpsDialog.tsx |
| ScreenOverview / Failures / Storage / Activity | new screens (rewrite plan §4); no React counterpart |
