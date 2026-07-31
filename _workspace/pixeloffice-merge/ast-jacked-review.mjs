import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const require = createRequire(
	path.join("E:/akselos-dev-3.10/PixelOffice-v2/backends/runtime/package.json"),
);
const typescript = require("typescript");
void fileURLToPath;

const root = "E:/akselos-dev-3.10/PixelOffice-v2";
const files = [
	"frontends/pixel_office/src/App.tsx",
	"frontends/pixel_office/src/components/jacked-sidebar-section.tsx",
	"frontends/pixel_office/src/components/home-sidebar-jacked.tsx",
	"frontends/pixel_office/src/jacked/jacked-accounts-view.tsx",
	"frontends/pixel_office/src/jacked/jacked-status-bar.tsx",
	"frontends/pixel_office/src/jacked/jacked-sidebar-config.tsx",
	"frontends/pixel_office/src/jacked/jacked-iframe-fallback.tsx",
	"frontends/pixel_office/src/jacked/jacked-settings-view.tsx",
	"frontends/pixel_office/src/office/office-e2e-harness.tsx",
	"backends/runtime/src/trpc/jacked-api.ts",
	"backends/runtime/src/jacked/jacked-client.ts",
];

function walk(node, visit) {
	visit(node);
	typescript.forEachChild(node, (child) => walk(child, visit));
}

const out = {
	imports: [],
	jsx: [],
	calls: [],
	routeIds: [],
	interestingStrings: [],
	missingFiles: [],
};

for (const rel of files) {
	const full = path.join(root, rel);
	if (!fs.existsSync(full)) {
		out.missingFiles.push(rel);
		continue;
	}
	const text = fs.readFileSync(full, "utf8");
	const sf = typescript.createSourceFile(rel, text, typescript.ScriptTarget.Latest, true, typescript.ScriptKind.TSX);
	walk(sf, (node) => {
		const line = () => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

		if (
			typescript.isImportDeclaration(node) &&
			node.moduleSpecifier &&
			typescript.isStringLiteral(node.moduleSpecifier)
		) {
			const mod = node.moduleSpecifier.text;
			if (mod.includes("jacked-accounts") || mod.includes("office-jacked-side") || mod.includes("jacked-sidebar")) {
				out.imports.push({ file: rel, line: line(), mod });
			}
		}

		if (typescript.isJsxSelfClosingElement(node) || typescript.isJsxOpeningElement(node)) {
			const tag = node.tagName.getText(sf);
			if (
				tag === "JackedAccountsView" ||
				tag === "ExternalLink" ||
				tag === "OfficeJackedSidePanel" ||
				tag === "JackedSidebarSection" ||
				tag === "JackedSidebarConfig"
			) {
				out.jsx.push({ file: rel, line: line(), tag });
			}
		}

		if (typescript.isCallExpression(node)) {
			const callee = node.expression.getText(sf);
			const interesting =
				callee === "window.open" ||
				callee.includes("startClaudeOAuth") ||
				callee.includes("submitOAuthCode") ||
				callee.includes("refuseNonClaude") ||
				callee.includes("useAccount") ||
				callee.includes("refreshAccount");
			if (interesting) {
				out.calls.push({
					file: rel,
					line: line(),
					callee,
					args: node.arguments.map((a) => a.getText(sf)).join(", ").slice(0, 140),
				});
			}
		}

		if (
			typescript.isPropertyAssignment(node) &&
			((typescript.isIdentifier(node.name) && node.name.text === "id") ||
				(typescript.isStringLiteral(node.name) && node.name.text === "id")) &&
			typescript.isStringLiteral(node.initializer)
		) {
			const id = node.initializer.text;
			if (["accounts", "installations", "settings", "logs", "analytics", "panel"].includes(id)) {
				out.routeIds.push({ file: rel, line: line(), id });
			}
		}

		if (typescript.isStringLiteral(node) || typescript.isNoSubstitutionTemplateLiteral(node)) {
			const v = node.text;
			if (
				v.includes("127.0.0.1:8321") ||
				v.includes("/#accounts") ||
				v === "Dash" ||
				v.toLowerCase().includes("open dashboard") ||
				v.includes("Only Claude accounts") ||
				v.includes("pip install") ||
				v === "Paste code"
			) {
				out.interestingStrings.push({ file: rel, line: line(), v });
			}
		}

		if (typescript.isBinaryExpression(node) && node.operatorToken.kind === typescript.SyntaxKind.EqualsEqualsEqualsToken) {
			const left = node.left.getText(sf);
			const right = node.right.getText(sf);
			if (left.includes("activeAccountId") || right.includes("activeAccountId")) {
				out.calls.push({
					file: rel,
					line: line(),
					callee: "EQ_activeAccountId",
					args: node.getText(sf).slice(0, 120),
				});
			}
		}

		if (typescript.isPropertyAccessExpression(node) && node.name.text === "ok") {
			const expr = node.expression.getText(sf);
			if (expr === "response") {
				out.calls.push({ file: rel, line: line(), callee: "response.ok", args: "" });
			}
		}
	});
}

const stackPath = path.join(root, "scripts/start-stack.mjs");
const stack = fs.readFileSync(stackPath, "utf8");
const waitHits = [...stack.matchAll(/waitForPort\(([^)]*)\)/g)].map((m) => ({
	match: m[0],
	index: m.index,
	line: stack.slice(0, m.index).split("\n").length,
}));
const installHints = [...stack.matchAll(/pip install[^\n"]*|uv sync/g)].map((m) => ({
	match: m[0],
	line: stack.slice(0, m.index).split("\n").length,
}));

const sidePanel = path.join(root, "frontends/pixel_office/src/office/jacked/office-jacked-side-panel.tsx");
const qaPath = path.join(root, "_workspace/pixeloffice-merge/05_merge-qa_review.md");
const qa = fs.existsSync(qaPath) ? fs.readFileSync(qaPath, "utf8") : "";

const result = {
	ast: out,
	startStack: { waitHits, installHints },
	sidePanelExists: fs.existsSync(sidePanel),
	staleQaClaims: {
		mentionsSidePanelStillInTree: qa.includes("office-jacked-side-panel.tsx") && qa.includes("still in tree"),
		mentionsDashInConfig: /Settings \/ Dash|Settings \/ Dash/.test(qa) || qa.includes("Settings / Dash"),
		mentionsJackedUserWatch: qa.includes("jacked-user-watch"),
	},
};

fs.writeFileSync(
	path.join(root, "_workspace/pixeloffice-merge/ast-jacked-review.json"),
	JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result, null, 2));
