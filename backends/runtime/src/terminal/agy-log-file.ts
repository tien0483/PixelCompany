/**
 * Classifies lines from `agy`'s own log file.
 *
 * A one-shot `agy` run reports nothing on stderr — it redirects both fd 1 and
 * fd 2 into `~/.gemini/antigravity-cli/log/cli-<ts>.log` while still writing
 * stream-json to the parent pipe. Measured on a controlled spawn: the parent
 * collected 2 KB of stream-json on stdout and **zero bytes** on stderr. So every
 * auth failure, quota refusal, model-resolution note and crash has always been
 * invisible to anything watching the process.
 *
 * `--log-file <path>` moves that log somewhere the runtime owns, which is what
 * makes it followable. Verified: with the flag set, fd 1 and fd 2 point at the
 * given path, all stream-json frames still arrive on stdout, and no NDJSON leaks
 * into the log.
 *
 * The log is far too chatty to forward wholesale — one `streamGenerateContent`
 * line per model call, and the whole pre-auth cache layer logs "You are not
 * logged into Antigravity" a dozen times on runs that then authenticate fine.
 * Hence an explicit noise list; forwarding those would raise a false alarm on
 * every successful build.
 */

/** What a classified log line means to a watcher. */
export type AgyLogLineKind = "error" | "notice";

export interface AgyLogLine {
	kind: AgyLogLineKind;
	line: string;
}

/**
 * glog's own preamble. agy emits every line through the "logging before
 * google.Init" path, so the prefix is on all of them, not just early ones.
 */
const AGY_LOG_PREFIX = /^ERROR: logging before google\.Init:\s*/;

/** `I0904 09:32:43.407384      82 errorreport.go:224] …` */
const AGY_LOG_HEADER = /^([IWEF])\d{4}\s+[\d:.]+\s+\d+\s+(\S+?)\]\s*(.*)$/;

/**
 * Sources that log on the happy path. `errorreport.go` and `cache.go` are the
 * important ones: they carry the pre-authentication "not logged into
 * Antigravity" churn at `E` severity on runs that succeed a moment later.
 */
const AGY_LOG_NOISE_SOURCES = [
	"http_helpers.go",
	"cache.go",
	"errorreport.go",
	"experiment_manager.go",
	"quota_manager.go",
	"model_config_manager.go",
	"declarative_config_loader.go",
	"analytics.go",
	"composite_token_storage.go",
];

/**
 * Startup chatter that agy reports as a failure on runs that then succeed.
 *
 * Measured on a clean run: it fails to fetch a Playwright driver (404), reports
 * a relative `.gemini` it then falls back from, and skips temp files while
 * indexing. None of it has anything to do with the job, and all of it is `E`
 * severity — so without this list every single build paints the log red.
 */
const AGY_LOG_BENIGN = [
	/failed to install playwright/i,
	/failed to resolve geminidir/i,
	/skipping empty or temp file/i,
	/skipping component during resolution/i,
	/admin controls not applicable/i,
	/recording trajectory segment analytics/i,
	// An in-flight request abandoned at shutdown. Every run ends with a few, and a
	// build the user cancelled already reports that in its own words.
	/context canceled/i,
];

/**
 * Worth surfacing whatever severity glog gave it.
 *
 * The quota patterns name the actual refusals rather than matching "quota"
 * anywhere: agy logs `quotaProject=` on every successful authentication, and a
 * bare substring turned that into a quota warning on healthy runs.
 */
const AGY_LOG_NOTABLE = [
	/print mode:/i,
	/resource_exhausted/i,
	/quota (?:exceeded|exhausted|limit)/i,
	/out of quota/i,
	/access_token_scope_insufficient/i,
	/permission_denied/i,
	/unauthenticated/i,
	/rate limit/i,
	/not in local config/i,
	/panic/i,
	/language server shutting down/i,
];

/** Informational even though it matches a notable pattern. */
const AGY_LOG_INFORMATIONAL = [/print mode: starting/i, /print mode: stream input closed/i];

const AGY_AUTH_EMAIL = /OAuth: authenticated successfully as (\S+@\S+)/;

/** Log lines are one line each; a stack-ish line should not flood the panel. */
const MAX_LOG_LINE_LENGTH = 300;

/**
 * The account `agy` actually authenticated as, when this line says so.
 *
 * Worth extracting because the pinned Manager seat does not decide it:
 * `resolveManagerAccountPin` returns no environment for `gemini` (Antigravity
 * credentials are machine-wide in `~/.gemini`, and the pin is honoured only for
 * its refusals), so a run bills whichever account the keyring holds. Surfacing
 * it is the difference between "my seat shows no usage" being a mystery and
 * being answered on screen.
 */
export function readAgyAuthenticatedAccount(line: string): string | null {
	const match = AGY_AUTH_EMAIL.exec(line);
	return match?.[1] ?? null;
}

/**
 * Returns the line a watcher should see, or null to drop it.
 *
 * Drops anything from a known-chatty source unless it is `F` (fatal) — a real
 * crash inside a noisy component still matters.
 */
export function classifyAgyLogLine(rawLine: string): AgyLogLine | null {
	const stripped = rawLine.replace(AGY_LOG_PREFIX, "").trim();
	if (stripped.length === 0) {
		return null;
	}

	const header = AGY_LOG_HEADER.exec(stripped);
	const severity = header?.[1] ?? null;
	const source = header?.[2] ?? "";
	const message = header?.[3]?.trim() ?? stripped;
	if (message.length === 0) {
		return null;
	}

	if (AGY_LOG_BENIGN.some((pattern) => pattern.test(message))) {
		return null;
	}

	const isNoisySource = AGY_LOG_NOISE_SOURCES.some((noisy) => source.startsWith(noisy));
	if (isNoisySource && severity !== "F") {
		return null;
	}

	const isNotable = AGY_LOG_NOTABLE.some((pattern) => pattern.test(message));
	const isSevere = severity === "E" || severity === "F";
	if (!isNotable && !isSevere) {
		return null;
	}

	const text = message.length > MAX_LOG_LINE_LENGTH ? `${message.slice(0, MAX_LOG_LINE_LENGTH - 1)}…` : message;
	const isInformational = AGY_LOG_INFORMATIONAL.some((pattern) => pattern.test(message));
	return { kind: isSevere && !isInformational ? "error" : "notice", line: text };
}
