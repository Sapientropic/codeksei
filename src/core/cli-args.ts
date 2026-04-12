// @ts-check

function sliceLeafCommandArgs(argv: any = process.argv, startIndex: number = 4) {
  return Array.isArray(argv) ? argv.slice(startIndex) : [];
}

function parseCliArgs(args: any, schema: any, {
  passthroughKey = "",
}: any = {}) {
  const normalizedArgs = Array.isArray(args) ? args.map((value: any) => String(value || "")) : [];
  const normalizedSchema = normalizeSchema(schema);
  const options: Record<string, any> = buildDefaultOptions(normalizedSchema);
  const flagMap = buildFlagMap(normalizedSchema.flags);
  const passthrough: string[] = [];
  const passthroughIgnore = new Set(
    Array.isArray(normalizedSchema.passthrough?.ignoreKeys)
      ? normalizedSchema.passthrough.ignoreKeys
      : []
  );
  const resolvedPassthroughKey = passthroughKey || normalizedSchema.passthrough?.key || "passthrough";

  for (let index = 0; index < normalizedArgs.length; index += 1) {
    const token = normalizedArgs[index].trim();
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
          passthrough.push(normalizedArgs[index + 1].trim());
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
      options[spec.name].push(value);
    } else {
      options[spec.name] = value;
    }
    index += 1;
  }

  if (normalizedSchema.passthrough) {
    options[resolvedPassthroughKey] = passthrough;
  }
  return options;
}

function normalizeSchema(schema: any) {
  return {
    flags: Array.isArray(schema?.flags) ? schema.flags : [],
    passthrough: schema?.passthrough || null,
  };
}

function buildDefaultOptions(schema: any) {
  const options: Record<string, any> = {};
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

function buildFlagMap(flags: any) {
  const flagMap = new Map();
  for (const flag of flags) {
    for (const key of Array.isArray(flag.keys) ? flag.keys : []) {
      flagMap.set(String(key), flag);
    }
  }
  return flagMap;
}

function shouldCapturePassthroughValue(token: any, next: any) {
  const normalizedToken = String(token || "").trim();
  const normalizedNext = String(next || "").trim();
  if (!normalizedToken.startsWith("--") || !normalizedNext || normalizedNext.startsWith("--")) {
    return false;
  }
  return true;
}

module.exports = {
  parseCliArgs,
  sliceLeafCommandArgs,
};

export {};
