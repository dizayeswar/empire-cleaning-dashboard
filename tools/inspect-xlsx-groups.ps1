Add-Type -AssemblyName System.IO.Compression.FileSystem
$path = Join-Path $env:USERPROFILE 'Desktop\Application door check.xlsx'
$zip = [IO.Compression.ZipFile]::OpenRead($path)

function Get-SharedStrings($zip) {
  $shared = @()
  $ssEntry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/sharedStrings.xml' }
  if (-not $ssEntry) { return $shared }
  $sr = New-Object IO.StreamReader($ssEntry.Open())
  $xml = [xml]$sr.ReadToEnd(); $sr.Close()
  $ns = New-Object Xml.XmlNamespaceManager($xml.NameTable)
  $ns.AddNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  foreach ($si in $xml.SelectNodes('//m:si', $ns)) {
    $texts = @()
    foreach ($t in $si.SelectNodes('.//m:t', $ns)) { if ($t.InnerText) { $texts += $t.InnerText } }
    $shared += ($texts -join '')
  }
  return $shared
}

function Col-ToIndex([string]$col) {
  $n = 0
  foreach ($ch in $col.ToCharArray()) { $n = $n * 26 + ([int][char]$ch - [int][char]'A' + 1) }
  return $n - 1
}

$shared = Get-SharedStrings $zip
$wb = [xml]((New-Object IO.StreamReader(($zip.Entries | Where-Object FullName -eq 'xl/workbook.xml').Open())).ReadToEnd())
$ns = New-Object Xml.XmlNamespaceManager($wb.NameTable)
$ns.AddNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
$rels = [xml]((New-Object IO.StreamReader(($zip.Entries | Where-Object FullName -eq 'xl/_rels/workbook.xml.rels').Open())).ReadToEnd())
$nsr = New-Object Xml.XmlNamespaceManager($rels.NameTable)
$nsr.AddNamespace('pr', 'http://schemas.openxmlformats.org/package/2006/relationships')
$relMap = @{}
foreach ($rel in $rels.SelectNodes('//pr:Relationship', $nsr)) { $relMap[$rel.Id] = $rel.Target }

foreach ($s in $wb.SelectNodes('//m:sheets/m:sheet', $ns)) {
  $name = $s.GetAttribute('name')
  $rid = $s.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $target = Split-Path $relMap[$rid] -Leaf
  $entry = $zip.Entries | Where-Object { $_.FullName -eq "xl/worksheets/$target" }
  $sr = New-Object IO.StreamReader($entry.Open())
  $xml = [xml]$sr.ReadToEnd(); $sr.Close()
  $ns2 = New-Object Xml.XmlNamespaceManager($xml.NameTable)
  $ns2.AddNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $header = $xml.SelectNodes('//m:sheetData/m:row', $ns2) | Select-Object -Index 1
  $cols = @()
  foreach ($c in $header.SelectNodes('m:c', $ns2)) {
    $ref = $c.GetAttribute('r')
    if ($ref -match '^([A-Z]+)') { $cols += Col-ToIndex $matches[1] }
  }
  Write-Output ("Sheet {0}: header cols at {1}" -f $name, ($cols -join ','))
}
$zip.Dispose()
