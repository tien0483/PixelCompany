import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Origins that may embed this site (PixelOffice Docs tab on common local ports). */
const FRAME_ANCESTORS = [
	"'self'",
	"http://127.0.0.1:3484",
	"http://localhost:3484",
	"http://127.0.0.1:5173",
	"http://localhost:5173",
].join(" ");

/** @type {import('next').NextConfig} */
const nextConfig = {
	pageExtensions: ["ts", "tsx", "md", "mdx"],
	images: {
		unoptimized: true,
	},
	outputFileTracingRoot: path.join(__dirname),
	async headers() {
		return [
			{
				source: "/:path*",
				headers: [
					{
						key: "Content-Security-Policy",
						value: `frame-ancestors ${FRAME_ANCESTORS}`,
					},
				],
			},
		];
	},
};

export default nextConfig;
