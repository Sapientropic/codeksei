export const HOST_SETTLE_RESULTS = [
  "sent_message",
  "silent",
  "backstage_only",
  "failed",
] as const;

export type HostSettleResult = typeof HOST_SETTLE_RESULTS[number];
