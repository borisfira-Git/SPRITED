using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;

[assembly: AssemblyTitle("SPRITED")]
[assembly: AssemblyDescription("Sprite Sheet Studio for Godot AnimatedSprite2D")]
[assembly: AssemblyCompany("SPRITED")]
[assembly: AssemblyProduct("SPRITED")]
[assembly: AssemblyCopyright("Copyright © 2026 SPRITED")]
[assembly: AssemblyVersion("0.6.10.0")]
[assembly: AssemblyFileVersion("0.6.10.0")]
[assembly: AssemblyInformationalVersion("0.6.10")]

namespace SpritedDesktop
{
    internal static class Program
    {
        private const string DisplayName = "SPRITED";
        private const string DisplayVersion = "VER.0.6.10";

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string edgePath = FindEdge();
            if (edgePath == null)
            {
                ShowError("Microsoft Edge is required and could not be found.");
                return;
            }

            string appPath = Path.Combine(
                AppDomain.CurrentDomain.BaseDirectory,
                "app",
                "index.html"
            );

            if (!File.Exists(appPath))
            {
                ShowError(
                    "The application files are missing.\n\n" +
                    "Keep SPRITED.exe and the app folder together."
                );
                return;
            }

            try
            {
                string profilePath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "SPRITED",
                    "BrowserProfile"
                );
                Directory.CreateDirectory(profilePath);

                string appUrl = new Uri(appPath).AbsoluteUri;
                ProcessStartInfo startInfo = new ProcessStartInfo
                {
                    FileName = edgePath,
                    Arguments =
                        "--app=\"" + appUrl + "\" " +
                        "--user-data-dir=\"" + profilePath + "\" " +
                        "--no-first-run --disable-default-apps " +
                        "--allow-file-access-from-files " +
                        "--disable-features=msEdgeFirstRunExperience",
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                Process.Start(startInfo);
            }
            catch (Exception error)
            {
                ShowError("SPRITED could not start.\n\n" + error.Message);
            }
        }

        private static void ShowError(string message)
        {
            MessageBox.Show(
                message + "\n\n" + DisplayVersion,
                DisplayName,
                MessageBoxButtons.OK,
                MessageBoxIcon.Error
            );
        }

        private static string FindEdge()
        {
            string[] roots =
            {
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)
            };

            foreach (string root in roots)
            {
                if (string.IsNullOrWhiteSpace(root))
                {
                    continue;
                }

                string candidate = Path.Combine(
                    root,
                    "Microsoft",
                    "Edge",
                    "Application",
                    "msedge.exe"
                );

                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            return null;
        }
    }
}
