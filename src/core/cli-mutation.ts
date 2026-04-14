import type { CommandEnvelope, CommandExecutionResult } from "../contracts/cli-contract";
import { lookupCliIdempotencyRecord, recordCliIdempotencyResult } from "./cli-idempotency";
import { normalizeText } from "./text-normalization";

interface CliMutationConfig {
  cliIdempotencyLedgerFile?: string;
}

export interface CliMutationMeta<
  TConfigSource extends Record<string, unknown> = Record<string, unknown>,
  TResolvedTargets extends Record<string, unknown> = Record<string, unknown>,
  TSideEffect extends Record<string, unknown> | string = Record<string, unknown> | string,
> extends Record<string, unknown> {
  configSource: TConfigSource;
  dryRun?: boolean;
  idempotency: {
    provided: boolean;
    replayed: boolean;
  };
  resolvedTargets: TResolvedTargets;
  sideEffects: TSideEffect[];
}

interface RunCliMutationOptions<
  TData,
  TRequest = unknown,
  TResolvedTargets extends Record<string, unknown> = Record<string, unknown>,
  TSideEffect extends Record<string, unknown> | string = Record<string, unknown> | string,
  TConfigSource extends Record<string, unknown> = Record<string, unknown>,
> {
  commandKey: string;
  config: CliMutationConfig;
  configSource?: TConfigSource;
  dryRun?: boolean;
  dryRunResult: CommandExecutionResult<TData>;
  execute: () => Promise<CommandExecutionResult<TData>>;
  idempotencyKey?: string;
  request: TRequest;
  resolvedTargets: TResolvedTargets;
  sideEffects: TSideEffect[];
}

export async function runCliMutation<
  TData,
  TRequest = unknown,
  TResolvedTargets extends Record<string, unknown> = Record<string, unknown>,
  TSideEffect extends Record<string, unknown> | string = Record<string, unknown> | string,
  TConfigSource extends Record<string, unknown> = Record<string, unknown>,
>({
  commandKey,
  config,
  configSource = {} as TConfigSource,
  dryRun = false,
  dryRunResult,
  execute,
  idempotencyKey = "",
  request,
  resolvedTargets,
  sideEffects,
}: RunCliMutationOptions<TData, TRequest, TResolvedTargets, TSideEffect, TConfigSource>): Promise<
  CommandExecutionResult<TData, CliMutationMeta<TConfigSource, TResolvedTargets, TSideEffect>>
> {
  const normalizedIdempotencyKey = normalizeText(idempotencyKey);
  const metaBase: CliMutationMeta<TConfigSource, TResolvedTargets, TSideEffect> = {
    configSource,
    resolvedTargets,
    sideEffects,
    idempotency: {
      provided: false,
      replayed: false,
    },
  };
  if (dryRun) {
    return {
      ...dryRunResult,
      meta: {
        ...metaBase,
        ...(dryRunResult.meta || {}),
        dryRun: true,
        idempotency: { provided: Boolean(normalizedIdempotencyKey), replayed: false },
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
      return envelopeToExecutionResult<TData, TConfigSource, TResolvedTargets, TSideEffect>(
        record.envelope as CommandEnvelope<TData, CliMutationMeta<TConfigSource, TResolvedTargets, TSideEffect>>,
        {
        ...metaBase,
        idempotency: { provided: true, replayed: true },
      },
      );
    }
  }

  const result = await execute();
  const envelope = {
    ok: result.ok || true,
    data: result.data,
    meta: {
      ...metaBase,
      ...(result.meta || {}),
      idempotency: { provided: Boolean(normalizedIdempotencyKey), replayed: false },
    },
    next: result.next,
  } satisfies CommandEnvelope<TData, CliMutationMeta<TConfigSource, TResolvedTargets, TSideEffect>>;

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

function envelopeToExecutionResult<
  TData,
  TConfigSource extends Record<string, unknown>,
  TResolvedTargets extends Record<string, unknown>,
  TSideEffect extends Record<string, unknown> | string,
>(
  envelope: CommandEnvelope<TData, CliMutationMeta<TConfigSource, TResolvedTargets, TSideEffect>>,
  metaOverride: CliMutationMeta<TConfigSource, TResolvedTargets, TSideEffect>,
): CommandExecutionResult<TData, CliMutationMeta<TConfigSource, TResolvedTargets, TSideEffect>> {
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
