# More GUI helpers on top of gui.ps1: the windows of a process (dialogs), foreground, keep-awake
. "$PSScriptRoot\gui.ps1"
Add-Type @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class W2 {
  public delegate bool EnumProc(IntPtr h, IntPtr p);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr p);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern void keybd_event(byte k, byte s, int f, int e);
  [DllImport("kernel32.dll")] public static extern uint SetThreadExecutionState(uint f);
  public static List<IntPtr> Of(uint pid) {
    var l = new List<IntPtr>();
    EnumWindows((h, p) => { uint q; GetWindowThreadProcessId(h, out q); if (q == pid && IsWindowVisible(h)) l.Add(h); return true; }, IntPtr.Zero);
    return l;
  }
  public static string Title(IntPtr h) { var s = new StringBuilder(512); GetWindowText(h, s, 512); return s.ToString(); }
}
"@

# visible top-level windows of the MESearch process: handle, title, rect
function Get-ProcWindows([int]$procId) {
  foreach ($w in [W2]::Of([uint32]$procId)) {
    $r = Get-Rect $w
    [pscustomobject]@{ H = $w; Title = [W2]::Title($w); L = $r.L; T = $r.T; W = $r.R - $r.L; Hh = $r.B - $r.T }
  }
}
# bring a window to the front; if SetForegroundWindow is refused, click its title bar
# (no Alt tap: an Alt press makes MESearch's Save Results fail with "Error when saving results")
function Focus-Hard($h) {
  for ($i = 0; $i -lt 5; $i++) {
    [W]::ShowWindow($h, 9) | Out-Null; [W]::SetForegroundWindow($h) | Out-Null; Start-Sleep -Milliseconds 150
    if ([W2]::GetForegroundWindow() -eq $h) { return $true }
    Click $h 300 12
    if ([W2]::GetForegroundWindow() -eq $h) { return $true }
  }
  $false
}
function Pixel($h, [int]$x, [int]$y) {
  $r = Get-Rect $h; $b = New-Object System.Drawing.Bitmap 1, 1; $g = [System.Drawing.Graphics]::FromImage($b)
  $g.CopyFromScreen($r.L + $x, $r.T + $y, 0, 0, $b.Size); $c = $b.GetPixel(0, 0); $g.Dispose(); $b.Dispose(); $c
}
# display and system stay on while this process lives (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
function Keep-Awake { [W2]::SetThreadExecutionState([uint32]2147483651) | Out-Null }
