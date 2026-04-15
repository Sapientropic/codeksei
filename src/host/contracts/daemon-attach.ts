export interface AttachedDaemonState {
  instanceId: string;
  bridgeProfile: string;
  pollLoopActive: boolean;
  scheduleOwner: "daemon";
  recoveryOwner: "daemon";
}
