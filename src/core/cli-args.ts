import type { CommandArgFlag, CommandArgSchema } from "../contracts/command-args";

type ParsedCliOptions = Record<string, boolean | string | string[]>;

interface ParseCliArgsOptions {
  passthroughKey?: string;
}

function parseCliArgs<T = ParsedCliOptions>(
  args: readonly string[],
  schema: CommandArgSchema | null,
  { passthroughKey = "" }: ParseCliArgsOptions = {},
): T {
  const normalizedArgs = Array.isArray(args) ? args.map((value) => String(value || "")) : [];
  const normalizedSchema = normalizeSchema(schema);
  const options: ParsedCliOptions = buildDefaultOptions(normalizedSchema);
  const flagMap = buildFlagMap(normalizedSchema.flags);
  const passthrough: string[] = [];
  const passthroughIgnore = new Set(
    Array.isArray(normalizedSchema.passthrough?.ignoreKeys)
      ? normalizedSchema.passthrough.ignoreKeys
      : []
  );
  const resolvedPassthroughKey = passthroughKey || normalizedSchema.passthrough?.key || "passthrough";

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const token = (normalizedArgs[index] || "").trim();
    if (!token) {
      continue;
    }

    if (passthroughIgnore.has(token)) {
      continue;
    }

    const spec = flagMap.get(token);
    if (!spec) {
      if (normalizedSchema.passthrough) {
        passthrough.push(token);
        if (shouldCapturePassthroughValue(token, normalizedArgs[index + 1])) {
          passthrough.push((normalizedArgs[index + 1] || "").trim());
          index += 1;
        }
        continue;
      }
      throw new Error(`未知参数: ${token}`);
    }

    if (spec.type === "boolean") {
      options[spec.name] = true;
      continue;
    }

    const next = normalizedArgs[index + 1] || "";
    if (!next.trim() || next.trim().startsWith("--")) {
      throw new Error(`参数缺少值: ${token}`);
    }
    const value = next.trim();
    if (spec.type === "string[]") {
      const list = Array.isArray(options[spec.name]) ? [...options[spec.name] as string[]] : [];
      list.push(value);
      options[spec.name] = list;
    } else {
      options[spec.name] = value;
    }
    index += 1;
  }

  if (normalizedSchema.passthrough) {
    options[resolvedPassthroughKey] = passthrough;
  }
  return options as T;
}

function normalizeSchema(schema: CommandArgSchema | null) {
  return {
    flags: Array.isArray(schema?.flags) ? schema.flags : [],
    passthrough: schema?.passthrough || null,
  };
}

function buildDefaultOptions(schema: Pick<CommandArgSchema, "flags">): ParsedCliOptions {
  const options: ParsedCliOptions = {};
  for (const flag of schema.flags) {
    if (flag.type === "string[]") {
      options[flag.name] = Array.isArray(flag.defaultValue) ? flag.defaultValue.slice() : [];
      continue;
    }
    if (flag.type === "boolean") {
      options[flag.name] = Boolean(flag.defaultValue);
      continue;
    }
    options[flag.name] = typeof flag.defaultValue === "string" ? flag.defaultValue : "";
  }
  return options;
}

function buildFlagMap(flags: readonly CommandArgFlag[]) {
  const flagMap = new Map<string, CommandArgFlag>();
  for (const flag of flags) {
    for (const key of Array.isArray(flag.keys) ? flag.keys : []) {
      flagMap.set(String(key), flag);
    }
  }
  return flagMap;
}

function shouldCapturePassthroughValue(token: unknown, next: unknown) {
  const normalizedToken = String(token || "").trim();
  const normalizedNext = String(next || "").trim();
  if (!normalizedToken.startsWith("--") || !normalizedNext || normalizedNext.startsWith("--")) {
    return false;
  }
  return true;
}

export {
  parseCliArgs,
};
