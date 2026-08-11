/**
 * Premade markdown blocks offered by the raw pane's insert menu. Ported in spirit from
 * `backends/html_anything/next/src/components/formats-gallery.tsx`, but as *skeletons*
 * instead of filled sample documents: there they replaced the whole textarea, here they
 * land at the cursor inside a plan the user is already writing.
 */

export interface MarkdownSnippet {
	id: string;
	label: string;
	/** one-line hint shown under the label in the menu */
	description: string;
	content: string;
}

export interface MarkdownSnippetGroup {
	label: string;
	snippets: ReadonlyArray<MarkdownSnippet>;
}

const TAB = "\t";

export const MARKDOWN_SNIPPET_GROUPS: ReadonlyArray<MarkdownSnippetGroup> = [
	{
		label: "Tables & data",
		snippets: [
			{
				id: "table",
				label: "Table",
				description: "3-column GFM table",
				content: `| Column | Column | Column |
| ------ | ------ | ------ |
|        |        |        |
|        |        |        |
`,
			},
			{
				id: "table-aligned",
				label: "Aligned table",
				description: "Left / center / right columns",
				content: `| Label | Metric | Value |
| :---- | :----: | ----: |
|       |        |       |
|       |        |       |
`,
			},
			{
				id: "csv",
				label: "CSV block",
				description: "Comma-separated rows",
				content: `\`\`\`csv
name,role,city
,,
\`\`\`
`,
			},
			{
				id: "tsv",
				label: "TSV block",
				description: "Tab-separated — pasted from Excel / Sheets",
				content: `\`\`\`tsv
name${TAB}role${TAB}city
${TAB}${TAB}
\`\`\`
`,
			},
		],
	},
	{
		label: "Code & config",
		snippets: [
			{
				id: "code",
				label: "Code fence",
				description: "Fenced block, language placeholder",
				content: `\`\`\`lang

\`\`\`
`,
			},
			{
				id: "json",
				label: "JSON block",
				description: "Structured object",
				content: `\`\`\`json
{
  "key": "value"
}
\`\`\`
`,
			},
			{
				id: "yaml",
				label: "YAML block",
				description: "Config with a nested list",
				content: `\`\`\`yaml
key: value
list:
  - item
\`\`\`
`,
			},
			{
				id: "sql",
				label: "SQL block",
				description: "SELECT skeleton",
				content: `\`\`\`sql
SELECT column
FROM table
WHERE condition;
\`\`\`
`,
			},
		],
	},
	{
		label: "Structure",
		snippets: [
			{
				id: "task-list",
				label: "Task list",
				description: "Three checkbox items",
				content: `- [ ] Task
- [ ] Task
- [ ] Task
`,
			},
			{
				id: "quote",
				label: "Quote",
				description: "Blockquote line",
				content: `> Quote
`,
			},
			{
				id: "details",
				label: "Collapsible",
				description: "<details> section, folds in the preview",
				content: `<details>
<summary>Summary</summary>

Hidden content.

</details>
`,
			},
		],
	},
];
