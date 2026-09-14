using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Windows.Forms;
[assembly: AssemblyTitle("SPRITED")]
[assembly: AssemblyProduct("SPRITED")]
[assembly: AssemblyVersion("0.11.0.0")]
[assembly: AssemblyFileVersion("0.11.0.0")]
[assembly: AssemblyInformationalVersion("0.12.0-dev")]
internal static class ProductLauncher {
 [STAThread] static void Main(){
  var script=Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"automation","Open-Library.ps1");
  try {
   if(!File.Exists(script))throw new Exception("Keep SPRITED.exe with its automation and app folders.");
   var args="-NoProfile -ExecutionPolicy Bypass -File \""+script+"\"";
   var dataDirectory=Environment.GetEnvironmentVariable("SPRITED_DATA_DIRECTORY");
   if(!String.IsNullOrWhiteSpace(dataDirectory))args+=" -DataDirectory \""+dataDirectory.Replace("\"","\"\"")+"\"";
   if(Environment.GetEnvironmentVariable("SPRITED_NO_OPEN")=="1")args+=" -NoOpen";
   var start=new ProcessStartInfo("powershell.exe",args){UseShellExecute=false,CreateNoWindow=true,RedirectStandardError=false};
   using(var process=Process.Start(start)){process.WaitForExit();if(process.ExitCode!=0)throw new Exception("Could not start SPRITED. See startup.log in your library folder. Your saved library has not been deleted.");}
  }catch(Exception e){MessageBox.Show(e.Message,"SPRITED could not start",MessageBoxButtons.OK,MessageBoxIcon.Error);}
 }
}
