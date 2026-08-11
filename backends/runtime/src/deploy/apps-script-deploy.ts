import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { findSavedPlanById, type SavedPlanEntry } from "../state/saved-plans";
import { CLASP_PROJECT_FILE, writeAppsScriptBundle } from "./apps-script-bundle";
import { type ClaspFailureKind, runClasp } from "./clasp-cli";
import { isClaspLoggedIn } from "./clasp-login";
import { loadPlanDeployConfig } from "./deploy-config";
import { readPlanDeployState, writePlanDeployState } from "./deploy-state";

export interface DeployPlanHtmlResult {
	ok: boolean;
	webAppUrl: string | null;
	scriptId: string | null;
	deploymentId: string | null;
	/** Human-readable transcript of the run, shown in the deploy dialog on success or failure. */
	log: string[];
	error: string | null;
	failure: ClaspFailureKind | null;
}

/** `- <deploymentId> @<version>` in `clasp deploy` / `clasp deployments` output. */
const DEPLOYMENT_ID_PATTERN = /-\s*([A-Za-z0-9_-]{20,})\s*@/;

export function parseDeploymentId(output: string): string | null {
	return DEPLOYMENT_ID_PATTERN.exec(output)?.[1] ?? null;
}

export function buildWebAppUrl(domain: string, deploymentId: string): string {
	const trimmedDomain = domain.trim();
	// The `/a/macros/<domain>/` form is the Workspace-scoped one; without it Google bounces
	// a domain-restricted deployment through an account chooser first.
	return trimmedDomain
		? `https://script.google.com/a/macros/${trimmedDomain}/s/${deploymentId}/exec`
		: `https://script.google.com/macros/s/${deploymentId}/exec`;
}

async function readScriptIdFromProjectFile(dir: string): Promise<string | null> {
	try {
		const raw = await readFile(join(dir, CLASP_PROJECT_FILE), "utf8");
		const parsed: unknown = JSON.parse(raw);
		if (parsed && typeof parsed === "object") {
			const scriptId = (parsed as Record<string, unknown>).scriptId;
			return typeof scriptId === "string" && scriptId.trim() ? scriptId.trim() : null;
		}
	} catch {
		// Falls through to the caller's error path, which has the clasp output to report.
	}
	return null;
}

interface HtmlPlanSource {
	entry: SavedPlanEntry;
	html: string;
	planDir: string;
}

async function loadHtmlPlan(planId: string): Promise<HtmlPlanSource> {
	const entry = await findSavedPlanById(planId);
	if (!entry) {
		throw new Error(`Plan "${planId}" was not found in the library.`);
	}
	if (!/\.html?$/i.test(entry.path)) {
		throw new Error("Only a generated HTML page can be deployed. Convert the plan to HTML first.");
	}
	// Deliberately the file on disk, not whatever is in the editor buffer: what gets
	// published is what was saved, and the assets it links to are resolved from the same place.
	const html = await readFile(entry.path, "utf8");
	if (html.trim().length === 0) {
		throw new Error("The generated HTML file is empty — nothing to deploy.");
	}
	return { entry, html, planDir: dirname(entry.path) };
}

/**
 * Push a plan's generated HTML to Apps Script and (re)deploy it as a Workspace web app.
 *
 * Re-deploys reuse the recorded `scriptId`/`deploymentId` so the URL people have already
 * been given keeps working; only the first run creates a project.
 */
export async function deployPlanHtml(input: { planId: string }): Promise<DeployPlanHtmlResult> {
	const log: string[] = [];
	const fail = (error: string, failure: ClaspFailureKind | null = null): DeployPlanHtmlResult => ({
		ok: false,
		webAppUrl: null,
		scriptId: null,
		deploymentId: null,
		log,
		error,
		failure,
	});

	let source: HtmlPlanSource;
	try {
		source = await loadHtmlPlan(input.planId);
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	}

	if (!(await isClaspLoggedIn())) {
		return fail("Not signed in to Google yet.", "needsLogin");
	}

	const config = await loadPlanDeployConfig();
	const previous = await readPlanDeployState(source.entry);
	const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
	const workDir = await mkdtemp(join(tmpdir(), "plan-deploy-"));

	try {
		let scriptId = previous?.scriptId ?? null;

		if (!scriptId) {
			log.push(`Creating a new Apps Script project for "${source.entry.name}"…`);
			const created = await runClasp(["create", "--type", "standalone", "--title", source.entry.name], {
				cwd: workDir,
			});
			log.push(created.output.trim());
			if (!created.ok) {
				return fail("Could not create the Apps Script project.", created.failure);
			}
			scriptId = await readScriptIdFromProjectFile(workDir);
			if (!scriptId) {
				return fail("The Apps Script project was created but its script id could not be read.");
			}
			log.push(`Script id: ${scriptId}`);
		} else {
			log.push(`Reusing Apps Script project ${scriptId}.`);
		}

		const bundle = await writeAppsScriptBundle({
			dir: workDir,
			html: source.html,
			planDir: source.planDir,
			title: source.entry.name,
			timeZone,
			scriptId,
		});
		log.push(`Bundled ${(bundle.pageBytes / 1024).toFixed(0)} KB page, ${bundle.inlined.length} asset(s) inlined.`);
		if (bundle.skipped.length > 0) {
			// Not fatal: the page still deploys, but those references will 404 in the browser.
			log.push(`Could not inline (will not load once deployed): ${bundle.skipped.join(", ")}`);
		}

		log.push("Pushing files…");
		const pushed = await runClasp(["push", "--force"], { cwd: workDir });
		log.push(pushed.output.trim());
		if (!pushed.ok) {
			return fail("Could not push the page to Apps Script.", pushed.failure);
		}

		const description = `${source.entry.name} — ${new Date().toISOString()}`;
		const deployArgs = previous?.deploymentId
			? ["deploy", "-i", previous.deploymentId, "--description", description]
			: ["deploy", "--description", description];
		log.push(previous?.deploymentId ? "Updating the existing deployment…" : "Creating the first deployment…");
		const deployed = await runClasp(deployArgs, { cwd: workDir });
		log.push(deployed.output.trim());
		if (!deployed.ok) {
			return fail("Could not deploy the web app.", deployed.failure);
		}

		let deploymentId = previous?.deploymentId ?? parseDeploymentId(deployed.output);
		if (!deploymentId) {
			// `clasp deploy` has changed its success line between releases; the listing is stable.
			const listed = await runClasp(["deployments"], { cwd: workDir });
			deploymentId = parseDeploymentId(listed.output);
		}
		if (!deploymentId) {
			return fail("The deployment succeeded but its id could not be read from clasp's output.");
		}

		const webAppUrl = buildWebAppUrl(config.domain, deploymentId);
		await writePlanDeployState(source.entry, {
			scriptId,
			deploymentId,
			webAppUrl,
			deployedAt: Date.now(),
		});
		log.push(`Deployed: ${webAppUrl}`);

		return { ok: true, webAppUrl, scriptId, deploymentId, log, error: null, failure: null };
	} catch (error) {
		return fail(error instanceof Error ? error.message : String(error));
	} finally {
		await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
	}
}
