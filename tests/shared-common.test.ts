const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnDetachedCommand } = require("../src/shared/shared-common");

test("spawnDetachedCommand closes the parent log fds after a successful detached spawn", () => {
  const closed: number[] = [];
  let nextFd = 41;
  let unrefCalled = false;

  const pid = spawnDetachedCommand("node", ["./dist/src/index.js"], { logFile: "shared.log" }, {
    buildSpawnInvocation(command: string, args: string[]) {
      return { command, args };
    },
    closeFd(fd: number) {
      closed.push(fd);
    },
    openLogFile() {
      const fd = nextFd;
      nextFd += 1;
      return fd;
    },
    spawn(command: string, args: string[], options: Record<string, unknown> & { stdio: [string, number, number] }) {
      assert.equal(command, "node");
      assert.deepEqual(args, ["./dist/src/index.js"]);
      assert.deepEqual(options.stdio, ["ignore", 41, 42]);
      return {
        pid: 1234,
        unref() {
          unrefCalled = true;
        },
      };
    },
  });

  assert.equal(pid, 1234);
  assert.equal(unrefCalled, true);
  assert.deepEqual(closed, [41, 42]);
});

test("spawnDetachedCommand closes the parent log fds when spawn throws", () => {
  const closed: number[] = [];
  let nextFd = 51;

  assert.throws(
    () => spawnDetachedCommand("node", ["./dist/src/index.js"], { logFile: "shared.log" }, {
      buildSpawnInvocation(command: string, args: string[]) {
        return { command, args };
      },
      closeFd(fd: number) {
        closed.push(fd);
      },
      openLogFile() {
        const fd = nextFd;
        nextFd += 1;
        return fd;
      },
      spawn(_command: string, _args: string[], _options: { stdio: [string, number, number] } & Record<string, unknown>) {
        throw new Error("spawn boom");
      },
    }),
    /spawn boom/,
  );

  assert.deepEqual(closed, [51, 52]);
});
