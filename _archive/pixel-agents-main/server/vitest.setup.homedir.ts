import { vi } from 'vitest';

// Windows-safe home isolation for tests.
// Many tests isolate state by setting `process.env.HOME = <tempDir>`, but on
// Windows `os.homedir()` reads `USERPROFILE`, not `HOME`, so those tests would
// read the developer's real `~/.pixel-agents` (and fail once it has real data).
// This global mock makes `os.homedir()` honor `process.env.HOME` when set,
// falling back to the real implementation otherwise. Under cmd.exe (how
// `vitest run` is spawned) `HOME` is unset by default, so non-isolated tests
// keep the real home.
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>();
  return {
    ...actual,
    default: actual,
    homedir: () => process.env.HOME || actual.homedir(),
  };
});
