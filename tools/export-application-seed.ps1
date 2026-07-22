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

function Col-ToIndex([string]$col) {
  $n = 0
  foreach ($ch in $col.ToCharArray()) {
    $n = $n * 26 + ([int][char]$ch - [int][char]'A' + 1)
  }
  return $n - 1
}

function Get-CellValue($cellNode, $shared, $ns) {
  if (-not $cellNode) { return '' }
  $vNode = $cellNode.SelectSingleNode('m:v', $ns)
  if (-not $vNode) { return '' }
  if ($cellNode.GetAttribute('t') -eq 's') { return [string]$shared[[int]$vNode.InnerText] }
  return [string]$vNode.InnerText
}

function Get-SheetRowMaps($zip, $sheetFile, $shared) {
  $sheetEntry = $zip.Entries | Where-Object { $_.FullName -eq "xl/worksheets/$sheetFile" }
  if (-not $sheetEntry) { return @() }
  $sr = New-Object System.IO.StreamReader($sheetEntry.Open())
  $sheetXml = [xml]$sr.ReadToEnd()
  $sr.Close()
  $ns = New-Object System.Xml.XmlNamespaceManager($sheetXml.NameTable)
  $ns.AddNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $rows = New-Object System.Collections.Generic.List[object]
  foreach ($row in $sheetXml.SelectNodes('//m:sheetData/m:row', $ns)) {
    $map = @{}
    foreach ($c in $row.SelectNodes('m:c', $ns)) {
      $ref = $c.GetAttribute('r')
      if ($ref -match '^([A-Z]+)([0-9]+)$') {
        $colIdx = Col-ToIndex $matches[1]
        $map[$colIdx] = Get-CellValue $c $shared $ns
      }
    }
    if ($map.Count -gt 0) { $rows.Add($map) }
  }
  return $rows
}

function Get-GroupStarts($headerMap) {
  $starts = New-Object System.Collections.Generic.List[int]
  foreach ($col in ($headerMap.Keys | Sort-Object)) {
    $label = [string]$headerMap[$col]
    if ($label.Trim().ToUpper() -eq 'PROPERTY') { $starts.Add($col) }
  }
  if (-not $starts.Count) {
    foreach ($col in ($headerMap.Keys | Sort-Object)) {
      if ($col % 4 -eq 0) { $starts.Add($col) }
    }
  }
  return $starts
}

function Normalize-Status($raw) {
  $s = [string]$raw
  $s = $s.Trim().ToUpper()
  if (-not $s) { return '' }
  $s = $s -replace '\s+', ' '
  if ($s -eq 'EMPTY') { return '' }
  return $s
}

function Parse-ProjectSheet($project, $rowMaps) {
  $out = New-Object System.Collections.Generic.List[object]
  if ($rowMaps.Count -lt 2) { return $out }
  $groupStarts = Get-GroupStarts $rowMaps[1]
  for ($ri = 2; $ri -lt $rowMaps.Count; $ri++) {
    $map = $rowMaps[$ri]
    foreach ($start in $groupStarts) {
      $property = [string]$map[$start]
      if (-not $property.Trim()) { continue }
      if ($property.Trim().ToUpper() -eq 'PROPERTY') { continue }
      $phone = [string]$map[($start + 1)]
      $status = Normalize-Status $map[($start + 2)]
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
  $rowMaps = Get-SheetRowMaps $zip $target $shared
  foreach ($item in (Parse-ProjectSheet $name $rowMaps)) {
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
