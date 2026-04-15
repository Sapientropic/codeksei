import {
  collectHermesHostedDoctorReport,
  collectHermesHostedStatusReport,
  collectHermesSkillCatalogProbe,
  runHermesHostedSmoke,
  type HostedHermesDiagnosticsConfigInput,
  type HermesHostedDoctorReport,
  type HermesHostedSmokeReport,
  type HermesHostedStatusReport,
  type HermesSkillCatalogProbe,
} from "../../../core/hosted-hermes-diagnostics";

export type {
  HostedHermesDiagnosticsConfigInput,
  HermesHostedDoctorReport,
  HermesHostedSmokeReport,
  HermesHostedStatusReport,
  HermesSkillCatalogProbe,
};

export function collectHermesRecipeDoctorReport(
  config: HostedHermesDiagnosticsConfigInput = {},
): HermesHostedDoctorReport {
  return collectHermesHostedDoctorReport(config);
}

export function collectHermesRecipeStatusReport(
  config: HostedHermesDiagnosticsConfigInput = {},
): HermesHostedStatusReport {
  return collectHermesHostedStatusReport(config);
}

export function collectHermesRecipeSkillCatalogProbe(
  config: Parameters<typeof collectHermesSkillCatalogProbe>[0],
): HermesSkillCatalogProbe {
  return collectHermesSkillCatalogProbe(config);
}

export function runHermesRecipeSmoke(
  config: HostedHermesDiagnosticsConfigInput = {},
): HermesHostedSmokeReport {
  return runHermesHostedSmoke(config);
}
