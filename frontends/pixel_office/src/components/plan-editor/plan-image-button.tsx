import { ImagePlus } from "lucide-react";
import { type ChangeEvent, type ReactElement, useRef } from "react";

import { ACCEPTED_TASK_IMAGE_INPUT_ACCEPT } from "@/components/task-image-input-utils";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

/**
 * The hidden-file-input half of "insert an image". Shared by the markdown toolbar, the
 * rich toolbar and the HTML source pane so all three offer the same picker — paste and
 * drop are handled by `usePlanImagePaste` on the surrounding element.
 */
export function PlanImageButton({
	disabled,
	onSelectFile,
}: {
	disabled?: boolean;
	onSelectFile: (file: File) => void;
}): ReactElement {
	const fileInputRef = useRef<HTMLInputElement>(null);

	const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0];
		// Reset first: picking the same file twice must fire `change` both times.
		event.target.value = "";
		if (file) {
			onSelectFile(file);
		}
	};

	return (
		<>
			<Tooltip content="Insert image">
				<Button
					variant="ghost"
					size="sm"
					icon={<ImagePlus size={14} />}
					aria-label="Insert image"
					disabled={disabled}
					onClick={() => fileInputRef.current?.click()}
				/>
			</Tooltip>
			<input
				ref={fileInputRef}
				type="file"
				accept={ACCEPTED_TASK_IMAGE_INPUT_ACCEPT}
				className="hidden"
				onChange={handleFileChange}
			/>
		</>
	);
}
