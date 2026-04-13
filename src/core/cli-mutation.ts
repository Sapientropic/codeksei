import type { CommandEnvelope, CommandExecutionResult } from "../contracts/cli-contract";
import { lookupCliIdempotencyRecord, recordCliIdempotencyResult } from "./cli-idempotency";
import { normalizeText } from "./text-normalization";

interface CliMutationConfig {
  cliIdempotencyLedgerFile?: string;
}

interface RunCliMutationOptions<T> {
  commandKey: string;
  config: CliMutationConfig;
  configSource?: Record<string, unknown>;
  dryRun?: boolean;
  dryRunResult: CommandExecutionResult<T>;
  execute: () => Promise<CommandExecutionResult<T>>;
  idempotencyKey?: string;
  request: unknown;
  resolvedTargets: Record<string, unknown>;
  sideEffects: Array<Record<string, unknown> | string>;
}

export async function runCliMutation<T>({
  commandKey,
  config,
  configSource = {},
  dryRun = false,
  dryRunResult,
  execute,
  idempotencyKey = "",
  request,
  resolvedTargets,
  sideEffects,
}: RunCliMutationOptions<T>): Promise<CommandExecutionResult<T>> {
  const normalizedIdempotencyKey = normalizeText(idempotencyKey);
  const metaBase = {
    configSource,
    resolvedTargets,
    sideEffects,
  };
  if (dryRun) {
    return {
      ...dryRunResult,
      meta: {
        ...metaBase,
        ...(dryRunResult.meta || {}),
        dryRun: true,
        idempotency: {
          provided: Boolean(normalizedIdempotencyKey),
          replayed: false,
        },
      },
    };
  }

  const ledgerFile = normalizeText(config.cliIdempotencyLedgerFile);
  if (normalizedIdempotencyKey && ledgerFile) {
    const record = lookupCliIdempotencyRecord({
      commandKey,
      filePath: ledgerFile,
      idempotencyKey: normalizedIdempotencyKey,
      request,
      resolvedTargets,
    });
    if (record) {
      return envelopeToExecutionResult<T>(record.envelope as CommandEnvelope<T>, {
        ...metaBase,
        idempotency: {
          provided: true,
          replayed: true,
        },
      });
    }
  }

  const result = await execute();
  const envelope = {
    ok: result.ok || true,
    data: result.data,
    meta: {
      ...metaBase,
      ...(result.meta || {}),
      idempotency: {
        provided: Boolean(normalizedIdempotencyKey),
        replayed: false,
      },
    },
    next: result.next,
  } satisfies CommandEnvelope<T>;

  if (normalizedIdempotencyKey && ledgerFile) {
    recordCliIdempotencyResult({
      commandKey,
      filePath: ledgerFile,
      idempotencyKey: normalizedIdempotencyKey,
      request,
      resolvedTargets,
    }, envelope);
  }

  return {
    ...result,
    meta: envelope.meta,
  };
}

function envelopeToExecutionResult<T>(
  envelope: CommandEnvelope<T>,
  metaOverride: Record<string, unknown>,
): CommandExecutionResult<T> {
  return {
    ok: envelope.ok === false ? true : envelope.ok,
    data: envelope.data,
    meta: {
      ...(envelope.meta || {}),
      ...metaOverride,
    },
    next: envelope.next,
  };
}
