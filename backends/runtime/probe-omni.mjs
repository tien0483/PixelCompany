// Temporary diagnostic probe (safe to delete).
import * as ClineCore from "@clinebot/core";

const manager = new ClineCore.ProviderSettingsManager();
console.log("has omniroute:", ClineCore.Llms.hasProvider("omniroute"), typeof manager.getFilePath);
const provider = ClineCore.Llms.getProvider("omniroute");
console.log("provider keys:", Object.keys(provider ?? {}));
console.log("provider proto:", Object.getOwnPropertyNames(Object.getPrototypeOf(provider ?? {})));
console.log("registerProvider arity:", ClineCore.Llms.registerProvider.length);
console.log("models:", ClineCore.Llms.getModelsForProvider?.("omniroute"));
console.log("provider dump:", JSON.stringify(provider, (k, v) => (typeof v === "function" ? "[fn]" : v)).slice(0, 800));
process.exit(0);
