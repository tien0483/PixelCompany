import { toast } from "sonner";

interface AppToastProps {
	intent?: "danger" | "warning" | "success" | "primary" | "none";
	icon?: string;
	message: string;
	timeout?: number;
	/** Inline button on the toast — the only affordance for one-shot Undo of a destructive write. */
	action?: { label: string; onClick: () => void };
}

interface NotifyErrorOptions {
	key?: string;
	timeout?: number;
}

export function showAppToast(props: AppToastProps, key?: string): void {
	const options: Parameters<typeof toast>[1] = {
		id: key,
		duration: props.timeout ?? 5000,
		...(props.action ? { action: props.action } : {}),
	};

	if (props.intent === "danger") {
		toast.error(props.message, options);
	} else if (props.intent === "warning") {
		toast.warning(props.message, options);
	} else if (props.intent === "success") {
		toast.success(props.message, options);
	} else {
		toast(props.message, options);
	}
}

export function notifyError(message: string | null | undefined, options?: NotifyErrorOptions): void {
	const normalized = message?.trim();
	if (!normalized) {
		return;
	}
	showAppToast(
		{
			intent: "danger",
			icon: "warning-sign",
			message: normalized,
			timeout: options?.timeout ?? 7000,
		},
		options?.key ?? `error:${normalized}`,
	);
}
