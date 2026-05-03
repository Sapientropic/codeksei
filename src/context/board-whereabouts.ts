import { normalizeText } from "../contracts/text-normalization";
import { readWhereaboutsSummary } from "../whereabouts/query";
import { collectWhereaboutsCapabilityReadiness } from "../whereabouts/readiness";
import { buildWhereaboutsStatusLine } from "../whereabouts/presentation";
import type { ContextBoardConfig, WhereaboutsContextSnapshot } from "./board";

export function collectWhereaboutsContextSnapshot(
  config: ContextBoardConfig,
  now: string,
): WhereaboutsContextSnapshot {
  const readiness = collectWhereaboutsCapabilityReadiness(config);
  if (!readiness.query.available) {
    return {
      available: false,
      reason: readiness.query.reason,
      statusLine: "",
      summary: null,
    };
  }
  const summary = readWhereaboutsSummary(config, { now });
  if (!normalizeText(summary.snapshot.lastEventAt)) {
    return {
      available: false,
      reason: "whereabouts 还没有本地位置事件。",
      statusLine: "",
      summary,
    };
  }
  const statusLine = `位置语义：${buildWhereaboutsStatusLine(summary)}`;
  return {
    available: true,
    reason: buildWhereaboutsStatusLine(summary),
    statusLine,
    summary,
  };
}
