# Export Application door check.xlsx -> assets/application-seed.json
param(
  [string]$XlsxPath = "$env:USERPROFILE\Desktop\Application door check.xlsx",
  [string]$OutPath = "$PSScriptRoot\..\assets\application-seed.json"
)

Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-SharedStrings($zip) {
  $shared = @()
  $ssEntry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/sharedStrings.xml' }
  if (-not $ssEntry) { return $shared }
  $sr = New-Object System.IO.StreamReader($ssEntry.Open())
  $xml = [xml]$sr.ReadToEnd()
  $sr.Close()
  $ns = New-Object System.Xml.XmlNamespaceManager($xml.NameTable)
  $ns.AddNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  foreach ($si in $xml.SelectNodes('//m:si', $ns)) {
    $texts = @()
    foreach ($t in $si.SelectNodes('.//m:t', $ns)) {
      if ($t.InnerText) { $texts += $t.InnerText }
    }
    $shared += ($texts -join '')
  }
  return $shared
}

function Get-SheetRows($zip, $sheetFile, $shared) {
  $sheetEntry = $zip.Entries | Where-Object { $_.FullName -eq "xl/worksheets/$sheetFile" }
  if (-not $sheetEntry) { return @() }
  $sr = New-Object System.IO.StreamReader($sheetEntry.Open())
  $sheetXml = [xml]$sr.ReadToEnd()
  $sr.Close()
  $ns = New-Object System.Xml.XmlNamespaceManager($sheetXml.NameTable)
  $ns.AddNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($row in $sheetXml.SelectNodes('//m:sheetData/m:row', $ns)) {
    $vals = @()
    foreach ($c in $row.SelectNodes('m:c', $ns)) {
      $vNode = $c.SelectSingleNode('m:v', $ns)
      if (-not $vNode) { $vals += ''; continue }
      if ($c.GetAttribute('t') -eq 's') { $vals += $shared[[int]$vNode.InnerText] }
      else { $vals += $vNode.InnerText }
    }
    if (($vals | Where-Object { $_.Trim() }).Count -gt 0) {
      $rows.Add(@($vals))
    }
  }
  return $rows
}

function Normalize-Status($raw) {
  $s = [string]$raw
  $s = $s.Trim().ToUpper()
  if (-not $s) { return '' }
  $s = $s -replace '\s+', ' '
  return $s
}

function Parse-ProjectSheet($project, $rows) {
  $out = New-Object System.Collections.Generic.List[object]
  if ($rows.Count -lt 3) { return $out }
  for ($ri = 2; $ri -lt $rows.Count; $ri++) {
    $row = $rows[$ri]
    for ($ci = 0; $ci -lt $row.Count; $ci += 3) {
      $property = [string]$row[$ci]
      if (-not $property.Trim()) { continue }
      $phone = ''
      $status = ''
      if ($ci + 1 -lt $row.Count) { $phone = [string]$row[$ci + 1] }
      if ($ci + 2 -lt $row.Count) { $status = Normalize-Status $row[$ci + 2] }
      $phone = ($phone -replace '\D', '').Trim()
      $out.Add([ordered]@{
        project    = $project
        propertyId = $property.Trim().ToUpper()
        phone      = $phone
        status     = $status
      })
    }
  }
  return $out
}

if (-not (Test-Path $XlsxPath)) {
  Write-Error "File not found: $XlsxPath"
  exit 1
}

$zip = [System.IO.Compression.ZipFile]::OpenRead($XlsxPath)
$shared = Get-SharedStrings $zip
$wb = [xml]((New-Object System.IO.StreamReader(($zip.Entries | Where-Object { $_.FullName -eq 'xl/workbook.xml' }).Open())).ReadToEnd())
$ns = New-Object System.Xml.XmlNamespaceManager($wb.NameTable)
$ns.AddNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
$ns.AddNamespace('r', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
$rels = [xml]((New-Object System.IO.StreamReader(($zip.Entries | Where-Object { $_.FullName -eq 'xl/_rels/workbook.xml.rels' }).Open())).ReadToEnd())
$nsr = New-Object System.Xml.XmlNamespaceManager($rels.NameTable)
$nsr.AddNamespace('pr', 'http://schemas.openxmlformats.org/package/2006/relationships')
$relMap = @{}
foreach ($rel in $rels.SelectNodes('//pr:Relationship', $nsr)) { $relMap[$rel.Id] = $rel.Target }

$all = New-Object System.Collections.Generic.List[object]
$seen = @{}
foreach ($s in $wb.SelectNodes('//m:sheets/m:sheet', $ns)) {
  $name = $s.GetAttribute('name')
  $rid = $s.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $target = Split-Path $relMap[$rid] -Leaf
  $rows = Get-SheetRows $zip $target $shared
  foreach ($item in (Parse-ProjectSheet $name $rows)) {
    $key = $item.project + '|' + $item.propertyId
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = $true
    $all.Add($item)
  }
}
$zip.Dispose()

$json = $all | ConvertTo-Json -Depth 4 -Compress:$false
$dir = Split-Path $OutPath -Parent
if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir | Out-Null }
[System.IO.File]::WriteAllText($OutPath, $json, [System.Text.UTF8Encoding]::new($false))
Write-Output "Wrote $($all.Count) records to $OutPath"
