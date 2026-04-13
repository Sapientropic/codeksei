export interface SharedProcessContext {
  rootDir: string;
  port: string;
  listenUrl: string;
  stateDir: string;
  logDir: string;
  accountsDir: string;
  sessionFile: string;
  appServerPidFile: string;
  bridgePidFile: string;
  supervisorPidFile: string;
  appServerLogFile: string;
  bridgeLogFile: string;
  supervisorLogFile: string;
  bridgeHeartbeatFile: string;
  watchdogStateFile: string;
  bridgeHeartbeatMaxAgeMs: number;
  sharedUseBundledCodexBinary: boolean;
  sharedDisablePlugins: boolean;
  sharedDisableShellSnapshot: boolean;
}

export interface SharedBridgeHeartbeatRecord {
  pid: number;
  status: string;
  accountId: string;
  workspaceRoot: string;
  runtimeEndpoint: string;
  startedAt: string;
  updatedAt: string;
  stoppedAt: string;
  lastPollStartedAt: string;
  lastPollSucceededAt: string;
  lastPollFailedAt: string;
  consecutiveFailures: number;
  lastError: string;
}

export interface SharedBridgeHeartbeatClassification {
  status: string;
  healthy: boolean;
  updatedAt: string;
}

export interface SharedBridgeHealth {
  pid: number;
  alive: boolean;
  heartbeat: SharedBridgeHeartbeatRecord | null;
  classification: SharedBridgeHeartbeatClassification;
  healthy: boolean;
}

export interface SharedAppServerHealthSnapshot {
  ready: boolean;
  readyPid: number;
  pidFromFile: number;
}

export interface SharedBridgeHealthSnapshot {
  pid: number;
  alive: boolean;
  healthy: boolean;
  heartbeatStatus: string;
  heartbeatUpdatedAt: string;
  lastError: string;
  consecutiveFailures: number;
}

export interface SharedHealthSnapshot {
  appServer: SharedAppServerHealthSnapshot;
  bridge: SharedBridgeHealthSnapshot;
}

export interface SharedWatchdogNotification {
  kind: string;
  sent: boolean;
  reason: string;
  senderId: string;
  workspaceRoot: string;
  sentAt: string;
}

export interface SharedWatchdogState {
  lastRunAt: string;
  result: string;
  actions: string[];
  error: string;
  before: SharedHealthSnapshot;
  after: SharedHealthSnapshot;
  lastAlertAt: string;
  lastAlertSignature: string;
  lastNotification: SharedWatchdogNotification | null;
}

export interface SharedWatchdogAlert {
  kind: "recovered" | "failed";
  signature: string;
  text: string;
}

export interface SharedStatusSnapshot {
  listenUrl: string;
  ready: boolean;
  readyAppServerPid: number;
  supervisorPid: number;
  appServerPid: number;
  bridgePid: number;
  bridgeHealth: SharedBridgeHealth;
  watchdogState: SharedWatchdogState | null;
}

export interface ManagedStopResult {
  pid: number;
  status: "missing" | "stale" | "unexpected_command" | "terminated";
  commandLine: string;
}
