import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BwrapProbeDeps, probeBwrap } from "@/sandbox/availability";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** A PATH dir containing empty stand-ins for the named executables. */
function makePathDir(executables: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "lc-sandbox-probe-"));
  tempDirs.push(dir);
  for (const name of executables) {
    writeFileSync(join(dir, name), "");
  }
  return dir;
}

type SpawnCall = { command: string; args: string[] };
type Spawn = NonNullable<BwrapProbeDeps["spawn"]>;

function recordingSpawn(respond: (call: SpawnCall) => ReturnType<Spawn>): {
  spawn: Spawn;
  calls: SpawnCall[];
} {
  const calls: SpawnCall[] = [];
  return {
    calls,
    spawn: (command, args) => {
      const call = { command, args };
      calls.push(call);
      return respond(call);
    },
  };
}

test("user-namespace probe runs `true` resolved from PATH, not /bin/true", () => {
  const dir = makePathDir(["bwrap", "true"]);
  const { spawn, calls } = recordingSpawn(() => ({ status: 0 }));

  const result = probeBwrap({ spawn, envPath: dir });

  expect(result.backend).toBe("bwrap");
  const usernsCall = calls.find((call) => call.args.includes("--unshare-user"));
  expect(usernsCall?.args.at(-1)).toBe(join(dir, "true"));
  expect(usernsCall?.args).not.toContain("/bin/true");
});

test("probe falls back to bwrap itself when `true` is not on PATH", () => {
  const dir = makePathDir(["bwrap"]);
  const { spawn, calls } = recordingSpawn(() => ({ status: 0 }));

  const result = probeBwrap({ spawn, envPath: dir });

  expect(result.backend).toBe("bwrap");
  const usernsCall = calls.find((call) => call.args.includes("--unshare-user"));
  expect(usernsCall?.args.slice(-2)).toEqual([
    join(dir, "bwrap"),
    "--version",
  ]);
});

test("probe failure reason includes bwrap's stderr", () => {
  const dir = makePathDir(["bwrap", "true"]);
  const { spawn } = recordingSpawn((call) =>
    call.args.includes("--unshare-user")
      ? {
          status: 1,
          stderr: Buffer.from(
            "bwrap: setting up uid map: Permission denied\nmore\n",
          ),
        }
      : { status: 0 },
  );

  const result = probeBwrap({ spawn, envPath: dir });

  expect(result.backend).toBeNull();
  expect(result.reason).toBe(
    "bwrap present but user namespaces are unavailable: " +
      "bwrap: setting up uid map: Permission denied",
  );
});

test("missing bwrap is reported without spawning anything", () => {
  const dir = makePathDir([]);
  const { spawn, calls } = recordingSpawn(() => ({ status: 0 }));

  expect(probeBwrap({ spawn, envPath: dir })).toEqual({
    backend: null,
    reason: "bwrap not found on PATH",
  });
  expect(calls).toHaveLength(0);
});
