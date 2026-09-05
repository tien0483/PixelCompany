/** Prefix a site-root path with Astro `base` (`/` locally, `/PixelCompany/` on project Pages). */
export function withBase(path: string): string {
	const base = import.meta.env.BASE_URL;
	if (!path || path === "/") {
		return base;
	}
	if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("//") || path.startsWith("#")) {
		return path;
	}
	const hashIdx = path.indexOf("#");
	const hash = hashIdx >= 0 ? path.slice(hashIdx) : "";
	const pathname = hashIdx >= 0 ? path.slice(0, hashIdx) : path;
	const clean = pathname.replace(/^\//, "");
	return `${base}${clean}${hash}`;
}

/** Strip Astro `base` from a pathname so nav matchers can use `/products`-style prefixes. */
export function stripBase(pathname: string): string {
	const base = import.meta.env.BASE_URL;
	if (base === "/") {
		return pathname;
	}
	const prefix = base.endsWith("/") ? base.slice(0, -1) : base;
	if (pathname === prefix || pathname === `${prefix}/`) {
		return "/";
	}
	if (pathname.startsWith(`${prefix}/`)) {
		return pathname.slice(prefix.length);
	}
	return pathname;
}
