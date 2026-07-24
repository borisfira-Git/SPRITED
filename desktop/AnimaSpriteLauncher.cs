using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace AnimaSpriteDesktop
{
    internal static class Program
    {
        private static HttpListener server;
        private static CancellationTokenSource cancellation;

        [STAThread]
        private static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);

            string edgePath = FindEdge();
            if (edgePath == null)
            {
                MessageBox.Show(
                    "AnimaSprite requires Microsoft Edge, which is included with Windows 10 and Windows 11.",
                    "AnimaSprite",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
                return;
            }

            int port = FindAvailablePort();
            cancellation = new CancellationTokenSource();
            server = new HttpListener();
            server.Prefixes.Add("http://127.0.0.1:" + port + "/");

            try
            {
                server.Start();
                Task.Run(() => ServeAsync(cancellation.Token));

                string profilePath = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "AnimaSprite",
                    "BrowserProfile"
                );
                Directory.CreateDirectory(profilePath);

                ProcessStartInfo startInfo = new ProcessStartInfo
                {
                    FileName = edgePath,
                    Arguments =
                        "--app=http://127.0.0.1:" + port + "/ " +
                        "--user-data-dir=\"" + profilePath + "\" " +
                        "--no-first-run --disable-default-apps " +
                        "--disable-features=msEdgeFirstRunExperience",
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                using (Process edge = Process.Start(startInfo))
                {
                    if (edge != null)
                    {
                        edge.WaitForExit();
                    }
                }
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    "AnimaSprite could not start.\n\n" + error.Message,
                    "AnimaSprite",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error
                );
            }
            finally
            {
                cancellation.Cancel();
                if (server.IsListening)
                {
                    server.Stop();
                }
                server.Close();
            }
        }

        private static async Task ServeAsync(CancellationToken token)
        {
            while (!token.IsCancellationRequested && server.IsListening)
            {
                try
                {
                    HttpListenerContext context = await server.GetContextAsync();
                    await SendResponseAsync(context);
                }
                catch (HttpListenerException)
                {
                    break;
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
            }
        }

        private static async Task SendResponseAsync(HttpListenerContext context)
        {
            string requestPath = context.Request.Url.AbsolutePath.ToLowerInvariant();
            string resourceName;
            string contentType;

            switch (requestPath)
            {
                case "/":
                case "/index.html":
                    resourceName = "AnimaSprite.index.html";
                    contentType = "text/html; charset=utf-8";
                    break;
                case "/style.css":
                    resourceName = "AnimaSprite.style.css";
                    contentType = "text/css; charset=utf-8";
                    break;
                case "/app.js":
                    resourceName = "AnimaSprite.app.js";
                    contentType = "application/javascript; charset=utf-8";
                    break;
                case "/favicon.svg":
                    resourceName = "AnimaSprite.favicon.svg";
                    contentType = "image/svg+xml";
                    break;
                case "/og.png":
                    resourceName = "AnimaSprite.og.png";
                    contentType = "image/png";
                    break;
                default:
                    context.Response.StatusCode = 404;
                    context.Response.Close();
                    return;
            }

            byte[] body = ReadEmbeddedResource(resourceName);
            context.Response.StatusCode = 200;
            context.Response.ContentType = contentType;
            context.Response.ContentLength64 = body.Length;
            context.Response.Headers["Cache-Control"] = "no-store";
            await context.Response.OutputStream.WriteAsync(body, 0, body.Length);
            context.Response.Close();
        }

        private static byte[] ReadEmbeddedResource(string resourceName)
        {
            Assembly assembly = Assembly.GetExecutingAssembly();
            using (Stream stream = assembly.GetManifestResourceStream(resourceName))
            {
                if (stream == null)
                {
                    return Encoding.UTF8.GetBytes("Missing application resource.");
                }

                using (MemoryStream memory = new MemoryStream())
                {
                    stream.CopyTo(memory);
                    return memory.ToArray();
                }
            }
        }

        private static int FindAvailablePort()
        {
            TcpListener listener = new TcpListener(IPAddress.Loopback, 0);
            listener.Start();
            int port = ((IPEndPoint)listener.LocalEndpoint).Port;
            listener.Stop();
            return port;
        }

        private static string FindEdge()
        {
            string[] candidates =
            {
                Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86),
                    "Microsoft",
                    "Edge",
                    "Application",
                    "msedge.exe"
                ),
                Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
                    "Microsoft",
                    "Edge",
                    "Application",
                    "msedge.exe"
                )
            };

            foreach (string candidate in candidates)
            {
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }

            return null;
        }
    }
}
