"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LIGHT_THEMES, THEME_LABELS, VALID_THEMES, type ThemeId } from "@/lib/themes";

function applyTheme(theme: ThemeId) {
	if (!theme || theme === "default") {
		document.documentElement.removeAttribute("data-theme");
	} else {
		document.documentElement.setAttribute("data-theme", theme);
	}
	if (LIGHT_THEMES.has(theme)) {
		document.documentElement.classList.remove("dark");
		document.documentElement.classList.add("light");
	} else {
		document.documentElement.classList.remove("light");
		document.documentElement.classList.add("dark");
	}
}

export function ThemePicker() {
	const [theme, setTheme] = useState<ThemeId>("default");

	useEffect(() => {
		try {
			const stored =
				sessionStorage.getItem("pixtiel_theme") ||
				localStorage.getItem("pixtiel_theme") ||
				localStorage.getItem("theme");
			if (stored && (VALID_THEMES as readonly string[]).includes(stored)) {
				setTheme(stored as ThemeId);
			}
		} catch {
			/* ignore */
		}
	}, []);

	function selectTheme(next: ThemeId) {
		setTheme(next);
		try {
			localStorage.setItem("pixtiel_theme", next);
			sessionStorage.setItem("pixtiel_theme", next);
		} catch {
			/* ignore */
		}
		applyTheme(next);
	}

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="sm"
					className="text-text-secondary hover:text-text-primary h-8 px-2"
					aria-label="Theme"
					title="Theme"
				>
					<svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
						<circle cx="12" cy="12" r="4" />
						<path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
					</svg>
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="max-h-72 overflow-y-auto">
				{VALID_THEMES.map((id) => (
					<DropdownMenuItem
						key={id}
						onClick={() => selectTheme(id)}
						className={theme === id ? "bg-surface-2 font-semibold" : undefined}
					>
						{THEME_LABELS[id]}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
