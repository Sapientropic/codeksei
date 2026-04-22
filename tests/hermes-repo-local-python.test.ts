const test: typeof import("node:test") = require("node:test");
const assert: typeof import("node:assert/strict") = require("node:assert/strict");

const {
  resolveHermesRepoLocalPythonInvocation,
}: typeof import("../src/core/hermes-repo-local") = require("../src/core/hermes-repo-local");

test("Hermes repo-local Python resolver prefers py -3 over python3 on Windows", () => {
  const result = resolveHermesRepoLocalPythonInvocation({}, {
    platform: "win32",
    resolveCommandOnPathImpl(command) {
      return {
        py: "C:/Windows/py.exe",
        python3: "C:/Users/Test/AppData/Local/Microsoft/WindowsApps/python3.exe",
      }[command] || "";
    },
    isUsablePythonInvocation(invocation) {
      return invocation.command.endsWith("/py.exe") && invocation.argsPrefix.join(" ") === "-3";
    },
  });

  assert.deepEqual(result, {
    command: "C:/Windows/py.exe",
    argsPrefix: ["-3"],
  });
});

test("Hermes repo-local Python resolver skips unusable Windows python stubs", () => {
  const result = resolveHermesRepoLocalPythonInvocation({}, {
    platform: "win32",
    resolveCommandOnPathImpl(command) {
      return {
        python: "C:/Users/Test/AppData/Local/Microsoft/WindowsApps/python.exe",
        py: "C:/Windows/py.exe",
      }[command] || "";
    },
    isUsablePythonInvocation(invocation) {
      return invocation.command.endsWith("/py.exe");
    },
  });

  assert.deepEqual(result, {
    command: "C:/Windows/py.exe",
    argsPrefix: ["-3"],
  });
});

test("Hermes repo-local Python resolver keeps python3 first on non-Windows platforms", () => {
  const result = resolveHermesRepoLocalPythonInvocation({}, {
    platform: "linux",
    resolveCommandOnPathImpl(command) {
      return command === "python3" ? "/usr/bin/python3" : "";
    },
    isUsablePythonInvocation(invocation) {
      return invocation.command === "/usr/bin/python3";
    },
  });

  assert.deepEqual(result, {
    command: "/usr/bin/python3",
    argsPrefix: [],
  });
});

test("Hermes repo-local Python resolver honors explicit py launcher as Python 3", () => {
  const result = resolveHermesRepoLocalPythonInvocation({
    hermesPythonCommand: "py",
  }, {
    platform: "win32",
    resolveCommandOnPathImpl(command) {
      return command === "py" ? "C:/Windows/py.exe" : "";
    },
    isUsablePythonInvocation() {
      return false;
    },
  });

  assert.deepEqual(result, {
    command: "C:/Windows/py.exe",
    argsPrefix: ["-3"],
  });
});
