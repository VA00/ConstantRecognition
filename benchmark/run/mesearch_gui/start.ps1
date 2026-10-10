# (Re)start MESearch 2.0 and set the search specification: all functions, all constants, length larger than 5
#
# MESearch (J. Zurutuza Salsamendi, 2013) has no command line; its license forbids redistribution, so the jar
# is not in the repository. Java: any JRE, e.g. the one bundled with Mathematica (the default below).
# Usage:  .\start.ps1 -Jar <path to MESearch.jar> [-MaxLength 5] [-Java <path to java.exe>]
param([Parameter(Mandatory)][string]$Jar, [int]$MaxLength = 5,
      [string]$Java = "C:\Program Files\Wolfram Research\Wolfram\15.0\SystemFiles\Java\Windows-x86-64\bin\java.exe")
. "$PSScriptRoot\gui2.ps1"
Get-Process java -ErrorAction SilentlyContinue | Where-Object MainWindowTitle -like "MESearch 2.0*" | Stop-Process -Force
Start-Sleep 1
$Jar = (Resolve-Path $Jar).Path
Start-Process -FilePath $Java -ArgumentList "-Xms1024m", "-Xmx8192m", "-jar", "`"$Jar`"" -WorkingDirectory (Split-Path $Jar) | Out-Null
$h = $null; $t0 = Get-Date
while (-not $h -and ((Get-Date) - $t0).TotalSeconds -lt 60) {
  Start-Sleep 1
  $h = (Get-Process java -ErrorAction SilentlyContinue | Where-Object MainWindowTitle -like "MESearch 2.0*" | Select-Object -First 1).MainWindowHandle
}
if (-not $h) { "MESearch did not start"; exit 1 }
Start-Sleep 2
[W]::MoveWindow($h, 20, 20, 1200, 900, $true) | Out-Null
Focus-Hard $h | Out-Null; Start-Sleep 1
function Ticked([int]$x, [int]$y) { $c = Pixel $h $x $y; $c.B -gt 150 -and $c.R -lt 100 }  # blue tick box
foreach ($xy in @(@(642, 141), @(642, 165), @(209, 264))) {      # Functions, Constants, Length larger than
  if (-not (Ticked $xy[0] $xy[1])) { Click $h $xy[0] $xy[1] }
}
Click $h 447 263; Keys "^a"; Keys "$MaxLength"
$ok = (Ticked 642 141) -and (Ticked 642 165) -and (Ticked 209 264)
"MESearch started, specification set: $ok"
