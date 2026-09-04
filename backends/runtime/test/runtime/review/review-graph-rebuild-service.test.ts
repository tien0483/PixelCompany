import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	checkProjectsGraphAvailability,
	copyUnderstandFolder,
	reviewGraphRebuildService,
} from "../../../src/review/review-graph-rebuild-service";

describe("review-graph-rebuild-service", () => {
	let tempRoot: string;
	let projectA: string;
	let projectB: string;

	beforeEach(async () => {
		tempRoot = await mkdtemp(path.join(tmpdir(), "review-rebuild-test-"));
		projectA = path.join(tempRoot, "projectA");
		projectB = path.join(tempRoot, "projectB");
		await mkdir(projectA, { recursive: true });
		await mkdir(projectB, { recursive: true });
		reviewGraphRebuildService.clearJobs();
	});

	afterEach(async () => {
		reviewGraphRebuildService.clearJobs();
		await rm(tempRoot, { recursive: true, force: true });
	});

	describe("copyUnderstandFolder", () => {
		it("fails when source and target paths are identical", async () => {
			const res = await copyUnderstandFolder({ sourcePath: projectA, targetPath: projectA });
			expect(res.ok).toBe(false);
			expect(res.error).toContain("cannot be identical");
		});

		it("fails when source project has no knowledge graph", async () => {
			const res = await copyUnderstandFolder({ sourcePath: projectA, targetPath: projectB });
			expect(res.ok).toBe(false);
			expect(res.error).toContain("No valid knowledge graph");
		});

		it("copies .ua directory successfully from source to target", async () => {
			const sourceUa = path.join(projectA, ".ua");
			await mkdir(sourceUa, { recursive: true });
			await writeFile(
				path.join(sourceUa, "knowledge-graph.json"),
				JSON.stringify({ version: "1.0.0", nodes: [{ id: "n1", name: "test" }] }),
			);
			await writeFile(path.join(sourceUa, "extra-data.txt"), "hello");

			const res = await copyUnderstandFolder({ sourcePath: projectA, targetPath: projectB });
			expect(res.ok).toBe(true);
			expect(res.targetDataDir).toBe(path.join(projectB, ".ua"));

			// Check target files
			const copiedGraph = await readFile(path.join(projectB, ".ua", "knowledge-graph.json"), "utf8");
			expect(JSON.parse(copiedGraph).version).toBe("1.0.0");
			const copiedExtra = await readFile(path.join(projectB, ".ua", "extra-data.txt"), "utf8");
			expect(copiedExtra).toBe("hello");
		});

		it("copies when source is legacy .understand-anything", async () => {
			const sourceLegacy = path.join(projectA, ".understand-anything");
			await mkdir(sourceLegacy, { recursive: true });
			await writeFile(
				path.join(sourceLegacy, "knowledge-graph.json"),
				JSON.stringify({ version: "1.0.0", nodes: [] }),
			);

			const res = await copyUnderstandFolder({ sourcePath: projectA, targetPath: projectB });
			expect(res.ok).toBe(true);
			expect(res.targetDataDir).toBe(path.join(projectB, ".ua"));

			const copiedGraph = await readFile(path.join(projectB, ".ua", "knowledge-graph.json"), "utf8");
			expect(JSON.parse(copiedGraph).version).toBe("1.0.0");
		});
	});

	describe("checkProjectsGraphAvailability", () => {
		it("reports which projects have a valid graph", async () => {
			const sourceUa = path.join(projectA, ".ua");
			await mkdir(sourceUa, { recursive: true });
			await writeFile(path.join(sourceUa, "knowledge-graph.json"), "{}");

			const result = await checkProjectsGraphAvailability([projectA, projectB]);
			expect(result[projectA]).toBe(true);
			expect(result[projectB]).toBe(false);
		});
	});

	describe("ReviewGraphRebuildService job lifecycle", () => {
		it("returns idle status when no job exists", () => {
			const status = reviewGraphRebuildService.getJobStatus("/not/exists");
			expect(status.ok).toBe(true);
			expect(status.status).toBe("idle");
		});

		it("allows pause, resume, and cancel on active jobs", () => {
			const { job, attached } = reviewGraphRebuildService.startOrAttachJob({
				projectPath: projectA,
			});
			expect(attached).toBe(false);
			expect(job.status).toBe("running");

			// Mock control
			job.control = {
				pause: () => true,
				resume: () => true,
				isPaused: () => false,
			};

			const pauseRes = reviewGraphRebuildService.pauseJob(projectA);
			expect(pauseRes.ok).toBe(true);
			expect(job.status).toBe("paused");

			const resumeRes = reviewGraphRebuildService.resumeJob(projectA);
			expect(resumeRes.ok).toBe(true);
			expect(job.status).toBe("running");

			const cancelRes = reviewGraphRebuildService.cancelJob(projectA);
			expect(cancelRes.ok).toBe(true);
			expect(job.status).toBe("error");
			expect(job.error).toContain("cancelled");
		});
	});
});
