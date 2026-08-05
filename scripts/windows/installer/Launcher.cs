using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

static class PixelOfficeLauncher
{
	[STAThread]
	static int Main(string[] args)
	{
		string installDir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');

		if (Array.IndexOf(args, "--stop") >= 0)
		{
			return RunStop(installDir);
		}

		string configPath = Path.Combine(installDir, "config.json");
		if (!File.Exists(configPath))
		{
			MessageBox.Show("PixelOffice config not found: " + configPath, "PixelOffice",
				MessageBoxButtons.OK, MessageBoxIcon.Error);
			return 1;
		}
		string configJson = File.ReadAllText(configPath);
		string url = ExtractJsonString(configJson, "Url") ?? "http://127.0.0.1:3484";
		Uri uri;
		try
		{
			uri = new Uri(url);
		}
		catch (Exception ex)
		{
			MessageBox.Show("Invalid Url in config.json: " + ex.Message, "PixelOffice",
				MessageBoxButtons.OK, MessageBoxIcon.Error);
			return 1;
		}
		return RunStart(installDir, uri);
	}

	static bool PortOpen(string hostName, int port, int timeoutMs)
	{
		try
		{
			using (var client = new TcpClient())
			{
				var result = client.BeginConnect(hostName, port, null, null);
				bool signaled = result.AsyncWaitHandle.WaitOne(timeoutMs);
				if (!signaled || !client.Connected) return false;
				client.EndConnect(result);
				return true;
			}
		}
		catch
		{
			return false;
		}
	}

	static int RunStop(string installDir)
	{
		string nodeExe = Path.Combine(installDir, "runtime", "node", "node.exe");
		string stopScript = Path.Combine(installDir, "stop.mjs");
		if (!File.Exists(nodeExe) || !File.Exists(stopScript))
		{
			MessageBox.Show("PixelOffice is not fully installed (missing runtime or stop.mjs).", "PixelOffice",
				MessageBoxButtons.OK, MessageBoxIcon.Error);
			return 1;
		}
		var psi = new ProcessStartInfo(nodeExe, "\"" + stopScript + "\"")
		{
			WorkingDirectory = installDir,
			UseShellExecute = false,
			CreateNoWindow = true,
		};
		try
		{
			using (var p = Process.Start(psi))
			{
				p.WaitForExit(15000);
				return p.HasExited ? p.ExitCode : 0;
			}
		}
		catch (Exception ex)
		{
			MessageBox.Show("Could not stop PixelOffice: " + ex.Message, "PixelOffice",
				MessageBoxButtons.OK, MessageBoxIcon.Error);
			return 1;
		}
	}

	static int RunStart(string installDir, Uri uri)
	{
		if (PortOpen(uri.Host, uri.Port, 500))
		{
			OpenAppWindow(uri.ToString());
			return 0;
		}

		using (var splash = new SplashForm())
		{
			splash.Show();
			splash.Refresh();

			if (!BootStack(installDir))
			{
				splash.Close();
				MessageBox.Show(
					"Could not start PixelOffice. Check " + Path.Combine(installDir, "solo.log"),
					"PixelOffice", MessageBoxButtons.OK, MessageBoxIcon.Error);
				return 1;
			}

			DateTime deadline = DateTime.UtcNow.AddSeconds(120);
			bool ready = false;
			while (DateTime.UtcNow < deadline)
			{
				if (PortOpen(uri.Host, uri.Port, 500)) { ready = true; break; }
				Application.DoEvents();
				Thread.Sleep(500);
			}

			splash.Close();

			if (!ready)
			{
				MessageBox.Show(
					"Timed out waiting for PixelOffice to start.\nCheck " + Path.Combine(installDir, "solo.log"),
					"PixelOffice", MessageBoxButtons.OK, MessageBoxIcon.Error);
				return 1;
			}
		}

		OpenAppWindow(uri.ToString());
		return 0;
	}

	// Writes a throwaway boot.cmd rather than shelling a quoted command line
	// directly (cmd.exe's quoting rules differ from CommandLineToArgvW, so a
	// hand-built /c string is a classic source of mis-parsed paths-with-spaces;
	// a generated .cmd file sidesteps that, matching install.mjs's writeCmd()).
	// This also avoids redirecting the child's stdout through a managed pipe:
	// a detached long-lived process needs a live reader to drain a pipe, but
	// cmd.exe's ">>" opens the log file with its own handle, so nothing needs
	// to keep reading after this launcher exits.
	static bool BootStack(string installDir)
	{
		string nodeExe = Path.Combine(installDir, "runtime", "node", "node.exe");
		string pythonExe = Path.Combine(installDir, "runtime", "python", "python.exe");
		string appDir = Path.Combine(installDir, "app");
		string soloScript = Path.Combine(appDir, "scripts", "solo.mjs");
		string logPath = Path.Combine(installDir, "solo.log");
		string bootBat = Path.Combine(installDir, "boot.cmd");

		if (!File.Exists(nodeExe) || !File.Exists(pythonExe) || !File.Exists(soloScript))
		{
			return false;
		}

		string batContents =
			"@echo off\r\n" +
			"cd /d \"" + appDir + "\"\r\n" +
			"set \"MANAGER_PYTHON=" + pythonExe + "\"\r\n" +
			"\"" + nodeExe + "\" \"" + soloScript + "\" --skip-build --no-open >> \"" + logPath + "\" 2>&1\r\n";
		File.WriteAllText(bootBat, batContents);

		var psi = new ProcessStartInfo(bootBat)
		{
			UseShellExecute = true,
			WindowStyle = ProcessWindowStyle.Hidden,
		};
		try
		{
			Process.Start(psi);
			return true;
		}
		catch
		{
			return false;
		}
	}

	static void OpenAppWindow(string url)
	{
		string[] candidates =
		{
			Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
			Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
			Environment.ExpandEnvironmentVariables(@"%LOCALAPPDATA%\Microsoft\Edge\Application\msedge.exe"),
			Environment.ExpandEnvironmentVariables(@"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
			Environment.ExpandEnvironmentVariables(@"%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"),
			Environment.ExpandEnvironmentVariables(@"%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"),
		};
		foreach (var exe in candidates)
		{
			if (File.Exists(exe))
			{
				Process.Start(new ProcessStartInfo(exe, "--app=" + url) { UseShellExecute = false });
				return;
			}
		}
		Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });
	}

	static string ExtractJsonString(string json, string key)
	{
		string pattern = "\"" + key + "\"";
		int idx = json.IndexOf(pattern, StringComparison.Ordinal);
		if (idx < 0) return null;
		int colon = json.IndexOf(':', idx + pattern.Length);
		if (colon < 0) return null;
		int firstQuote = json.IndexOf('"', colon + 1);
		if (firstQuote < 0) return null;
		int secondQuote = json.IndexOf('"', firstQuote + 1);
		if (secondQuote < 0) return null;
		return json.Substring(firstQuote + 1, secondQuote - firstQuote - 1);
	}
}

class SplashForm : Form
{
	public SplashForm()
	{
		Text = "PixelOffice";
		FormBorderStyle = FormBorderStyle.FixedDialog;
		StartPosition = FormStartPosition.CenterScreen;
		ClientSize = new System.Drawing.Size(320, 100);
		ControlBox = false;
		MinimizeBox = false;
		MaximizeBox = false;
		TopMost = true;
		var label = new Label
		{
			Text = "Starting PixelOffice...",
			Dock = DockStyle.Fill,
			TextAlign = System.Drawing.ContentAlignment.MiddleCenter,
			Font = new System.Drawing.Font("Segoe UI", 11),
		};
		Controls.Add(label);
	}
}
