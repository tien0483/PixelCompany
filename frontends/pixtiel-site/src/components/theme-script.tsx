export const THEME_SCRIPT = `(function () {
	var VALID_THEMES = new Set([
		"default",
		"graphite",
		"midnight",
		"pitch",
		"solarized-dark",
		"light",
		"overcast",
		"solarized-light",
		"latte",
		"high-contrast-dark",
		"high-contrast-light",
	]);
	var LIGHT_THEMES = new Set([
		"light",
		"overcast",
		"solarized-light",
		"latte",
		"high-contrast-light",
	]);

	function applyTheme(theme) {
		if (!theme || !VALID_THEMES.has(theme) || theme === "default") {
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

	try {
		var params = new URLSearchParams(window.location.search);
		var paramTheme = params.get("theme");
		if (paramTheme && VALID_THEMES.has(paramTheme)) {
			sessionStorage.setItem("pixtiel_theme", paramTheme);
			applyTheme(paramTheme);
		} else {
			var stored =
				sessionStorage.getItem("pixtiel_theme") ||
				localStorage.getItem("pixtiel_theme") ||
				localStorage.getItem("theme");
			if (stored && VALID_THEMES.has(stored)) {
				applyTheme(stored);
			} else {
				applyTheme("default");
			}
		}
		if (params.get("embed") === "true" || window.self !== window.top) {
			document.documentElement.classList.add("is-embedded");
		}
	} catch (e) {
		applyTheme("default");
	}

	window.addEventListener("message", function (event) {
		if (!event || !event.data) return;
		if (event.data.type === "theme-change" || event.data.type === "set-theme") {
			var nextTheme = event.data.theme || event.data.themeId;
			if (typeof nextTheme === "string" && VALID_THEMES.has(nextTheme)) {
				try {
					sessionStorage.setItem("pixtiel_theme", nextTheme);
				} catch (e) {}
				applyTheme(nextTheme);
			}
		}
	});
})();`;

export function ThemeScript() {
	return <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />;
}
