import type {
	RuntimeHtmlStatus,
	RuntimeHtmlTemplate,
	RuntimeHtmlTemplateExample,
} from "../core/api-contract";
import type { HtmlClient } from "../html/html-client";
import type { RuntimeTrpcContext } from "./app-router";

export interface CreateHtmlApiDependencies {
	client: HtmlClient;
}

export function createHtmlApi(deps: CreateHtmlApiDependencies): RuntimeTrpcContext["htmlApi"] {
	return {
		status: async (): Promise<RuntimeHtmlStatus> => await deps.client.status(),
		templates: async (): Promise<RuntimeHtmlTemplate[]> => {
			return (await deps.client.fetchTemplates()) ?? [];
		},
		templateExample: async (id: string): Promise<RuntimeHtmlTemplateExample | null> => {
			return await deps.client.fetchTemplateExample(id);
		},
	};
}
