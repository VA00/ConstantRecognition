# Unattended MESearch run over a targets file (id<TAB>target): one results file <OutDir>\<id>.txt per constant.
# Resumable: ids with a results file are skipped. Every saved file is checked (its target must equal ours).
# MESearch must be running with the search specification already set (start.ps1);
# the window is kept at 20,20 1200x900 (all coordinates below assume this, at 150 % display scaling).
# It drives the mouse and keyboard: the PC must be left alone while it runs (about 11 s per constant).
# Usage:  .\batch.ps1 -Targets <targets.tsv from make_targets_v0.py> -OutDir <dir> [-TimeoutSec 600] [-Only "1,2,3"]
param([string]$Targets, [string]$OutDir, [int]$TimeoutSec = 900, [int]$Limit = 0, [string]$Only = "")
. "$PSScriptRoot\gui2.ps1"
Keep-Awake
New-Item -ItemType Directory -Force $OutDir | Out-Null
$log = Join-Path $OutDir "log.tsv"
if (-not (Test-Path $log)) { "id`ttarget`tstatus`tseconds`tfinished`tnote" | Out-File $log -Encoding utf8 }
function Log([string]$line) { $line | Out-File $log -Append -Encoding utf8; Write-Output $line }

function Get-MES { Get-Process java -ErrorAction SilentlyContinue | Where-Object MainWindowTitle -like "MESearch 2.0*" | Select-Object -First 1 }
function Dialogs($p, $h) { @(Get-ProcWindows $p.Id | Where-Object { $_.H -ne $h -and $_.W -gt 20 -and $_.Hh -gt 20 }) }
$shots = 0
# dismiss every dialog: unsaved-results question -> No, file chooser -> Cancel, anything else -> screenshot + Enter
function Close-Dialogs($p, $h, [string]$id) {
  $notes = @()
  for ($k = 0; $k -lt 5; $k++) {
    $ds = Dialogs $p $h
    if ($ds.Count -eq 0) { break }
    foreach ($d in $ds) {
      Focus-Hard $d.H | Out-Null
      if ($d.Title -eq "Starting the search") { Click $d.H 365 145 }
      elseif ($d.Title -eq "Save results as") { Click $d.H 865 609 }
      else {
        $script:shots++; $png = Join-Path $OutDir ("dialog_{0}_{1}.png" -f $id, $script:shots)
        Shot $d.H $png | Out-Null; $notes += "dialog '$($d.Title)' $png"; Keys "{ENTER}"
      }
      Start-Sleep -Milliseconds 300
    }
  }
  $notes -join "; "
}
function Running($h) { $c = Pixel $h 185 96; $c.R -gt 150 -and $c.G -lt 100 }   # Stop button red
function ResultsView($h) { (Pixel $h 100 130).R -lt 80 -or (Pixel $h 100 131).R -lt 80 }  # "Search results" rule

function Run-One([string]$id, [string]$target, [string]$out) {
  $p = Get-MES; if (-not $p) { return @("no-mesearch", 0, "") }
  $h = $p.MainWindowHandle
  [W]::MoveWindow($h, 20, 20, 1200, 900, $true) | Out-Null
  $note = Close-Dialogs $p $h $id
  Focus-Hard $h | Out-Null; Keys "{ESC}"
  Click $h 81 61; Click $h 165 101                                  # View > Specification
  if (ResultsView $h) { Keys "{ESC}"; Click $h 81 61; Click $h 165 101 }
  if (ResultsView $h) { return @("no-spec-view", 0, $note) }
  Click $h 245 150; Keys "^a"; Keys ($target -replace '([+^%~(){}\[\]])', '{$1}')   # target constant (SendKeys-escaped)
  $t0 = Get-Date
  Click $h 150 96                                                   # Start
  # started = results view shown (the "unsaved results" question may come first)
  $started = $false
  while (((Get-Date) - $t0).TotalSeconds -lt 15) {
    $ds = Dialogs $p $h
    if ($ds.Count -gt 0) {
      if ($ds[0].Title -eq "Starting the search") { Focus-Hard $ds[0].H | Out-Null; Click $ds[0].H 365 145; $t0 = Get-Date; continue }
      $n = Close-Dialogs $p $h $id; return @("dialog", 0, "$note $n")
    }
    if (ResultsView $h) { $started = $true; break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $started) { return @("not-started", 0, $note) }
  $status = "done"
  while (Running $h) {
    if (((Get-Date) - $t0).TotalSeconds -gt $TimeoutSec) {
      Focus-Hard $h | Out-Null; Click $h 185 96; $status = "timeout"     # Stop: partial results are saved
      $t1 = Get-Date; while ((Running $h) -and ((Get-Date) - $t1).TotalSeconds -lt 60) { Start-Sleep -Milliseconds 250 }
      break
    }
    if ((Dialogs $p $h).Count -gt 0) { $n = Close-Dialogs $p $h $id; $note = "$note $n" }
    Start-Sleep -Milliseconds 250
  }
  $sec = ((Get-Date) - $t0).TotalSeconds
  Start-Sleep -Milliseconds 300
  # Save Results (Ctrl+R) -> file chooser, full path, Enter
  Focus-Hard $h | Out-Null; Keys "^r"
  $d = $null; $t1 = Get-Date
  while (-not $d -and ((Get-Date) - $t1).TotalSeconds -lt 10) { Start-Sleep -Milliseconds 150; $d = Dialogs $p $h | Where-Object Title -eq "Save results as" | Select-Object -First 1 }
  if (-not $d) { $n = Close-Dialogs $p $h $id; return @("no-save-dialog", $sec, "$note $n") }
  Focus-Hard $d.H | Out-Null; Start-Sleep -Milliseconds 200
  Keys $out; Keys "{ENTER}"
  $t1 = Get-Date
  while (-not (Test-Path $out) -and ((Get-Date) - $t1).TotalSeconds -lt 15) { Start-Sleep -Milliseconds 150 }
  Start-Sleep -Milliseconds 300
  $n = Close-Dialogs $p $h $id; if ($n) { $note = "$note $n" }
  if (-not (Test-Path $out)) { return @("not-saved", $sec, $note) }
  @($status, $sec, $note)
}

function Check-File([string]$out, [string]$target) {
  $txt = Get-Content $out -Raw -ErrorAction SilentlyContinue
  if (-not $txt -or $txt -notmatch "Search results:") { return "incomplete file" }
  if ($txt -notmatch "Target constant:\s*(\S+)") { return "no target line" }
  $a = [double]::Parse($Matches[1], [Globalization.CultureInfo]::InvariantCulture)
  $b = [double]::Parse($target, [Globalization.CultureInfo]::InvariantCulture)
  if ($a -ne $b) { return "target in file $($Matches[1])" }
  ""
}

$rows = Import-Csv $Targets -Delimiter "`t"
if ($Only) { $ids = $Only -split ","; $rows = $rows | Where-Object { $ids -contains $_.id } }
$count = 0
foreach ($r in $rows) {
  $out = Join-Path $OutDir "$($r.id).txt"
  if (Test-Path $out) { continue }
  if ($Limit -gt 0 -and $count -ge $Limit) { break }
  $count++
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    $res = Run-One $r.id $r.target $out
    $status, $sec, $note = $res
    if ($status -eq "done" -or $status -eq "timeout") {
      $bad = Check-File $out $r.target
      if ($bad) { Move-Item $out ("$out.bad{0}" -f $attempt) -Force; $status = "bad-file"; $note = "$note $bad" }
    }
    Log ("{0}`t{1}`t{2}`t{3:F1}`t{4:yyyy-MM-dd HH:mm:ss}`t{5}" -f $r.id, $r.target, $status, $sec, (Get-Date), $note.Trim())
    if ($status -eq "done" -or $status -eq "timeout") { break }
    if ($status -eq "no-mesearch") { exit 2 }
    Start-Sleep 2
  }
}
Log "# batch finished $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $count constants attempted"
