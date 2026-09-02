/** Fired after Manager installs/uninstalls packs or features that change ~/.claude/skills. */
export const SKILL_INVENTORY_CHANGED_EVENT = "pixtiel:skill-inventory-changed";

export function notifySkillInventoryChanged(): void {
	if (typeof window === "undefined") {
		return;
	}
	window.dispatchEvent(new Event(SKILL_INVENTORY_CHANGED_EVENT));
}
