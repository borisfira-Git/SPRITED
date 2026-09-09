using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
[assembly: AssemblyTitle("SPRITED")]
[assembly: AssemblyProduct("SPRITED")]
[assembly: AssemblyFileVersion("0.8.0.3")]
[assembly: AssemblyInformationalVersion("0.8.0-preview.3")]
internal static class ProductLauncher {
 [STAThread] static void Main(){
  var script=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"automation","Open-Library.ps1");
  try {
   if(!File.Exists(script))throw new Exception("Keep SPRITED.exe with its automation and app folders.");
   var start=new ProcessStartInfo("powershell.exe","-NoProfile -ExecutionPolicy Bypass -File \""+script+"\""){UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=true};
   using(var process=Process.Start(start)){var errors=process.StandardError.ReadToEnd();process.WaitForExit();if(process.ExitCode!=0)throw new Exception(errors);}
  }catch(Exception e){MessageBox.Show(e.Message,"SPRITED could not start",MessageBoxButtons.OK,MessageBoxIcon.Error);}
 }
}
