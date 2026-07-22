/**
 * BSD `sysexits.h` exit codes shared across the CLI fleet.
 *
 * Only the subset actually used by apps is included so exit-code
 * policy stays reviewable. Use these with {@link exitProcess} or a
 * failure-to-exit-code mapper instead of repeating numeric literals.
 */
export const SYS_EXITS = {
  /** `EX_OK` (0): successful termination. */
  ok: 0,
  /** `EX_USAGE` (64): command line usage error, such as bad arguments or flags. */
  usage: 64,
  /** `EX_DATAERR` (65): input data was incorrect in some way. */
  dataErr: 65,
  /** `EX_NOINPUT` (66): an input file did not exist or was not readable. */
  noInput: 66,
  /** `EX_SOFTWARE` (70): internal software error not caused by the operating system. */
  software: 70,
  /** `EX_IOERR` (74): an error occurred while doing I/O on a file. */
  ioErr: 74,
  /** `EX_CONFIG` (78): something was found in an unconfigured or misconfigured state. */
  config: 78,
} as const

/** Exit code drawn from the supported `sysexits.h` vocabulary. */
export type SysExitCode = typeof SYS_EXITS[keyof typeof SYS_EXITS]
