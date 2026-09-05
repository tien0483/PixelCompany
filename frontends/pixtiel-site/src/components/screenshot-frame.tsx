import { cn } from "@/lib/utils";

type ScreenshotFrameProps = {
	id?: string;
	src: string;
	alt: string;
	title: string;
	aspectRatio?: string;
	className?: string;
	loading?: "eager" | "lazy";
};

export function ScreenshotFrame({
	id,
	src,
	alt,
	title,
	aspectRatio = "aspect-16/10",
	className = "",
	loading = "lazy",
}: ScreenshotFrameProps) {
	const imageSrc = src.startsWith("/") ? src : src;

	return (
		<div
			id={id}
			className={cn(
				"w-full rounded-xl border border-border bg-surface-1 overflow-hidden shadow-2xl transition-all duration-200 hover:border-border-bright",
				className,
			)}
		>
			<div className="px-4 py-3 bg-surface-0 border-b border-border flex items-center justify-between">
				<div className="flex items-center gap-2">
					<span className="w-3 h-3 rounded-full bg-[#FF5F56]/80 inline-block"></span>
					<span className="w-3 h-3 rounded-full bg-[#FFBD2E]/80 inline-block"></span>
					<span className="w-3 h-3 rounded-full bg-[#27C93F]/80 inline-block"></span>
				</div>
				<div className="px-3 py-1 rounded bg-surface-1 border border-border text-xs font-mono text-text-secondary max-w-[280px] truncate text-center">
					{title}
				</div>
				<div className="w-12"></div>
			</div>

			<div
				className={cn(
					"w-full bg-surface-0 relative overflow-hidden flex items-center justify-center",
					aspectRatio,
				)}
			>
				<img
					src={imageSrc}
					alt={alt}
					loading={loading}
					className="w-full h-full object-cover object-top block"
				/>
			</div>
		</div>
	);
}
