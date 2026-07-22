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
  if ($s.GetAttribute('name') -ne 'RA') { continue }
  $rid = $s.GetAttribute('id', 'http://schemas.openxmlformats.org/officeDocument/2006/relationships')
  $target = Split-Path $relMap[$rid] -Leaf
  $entry = $zip.Entries | Where-Object { $_.FullName -eq "xl/worksheets/$target" }
  $sr = New-Object IO.StreamReader($entry.Open())
  $xml = [xml]$sr.ReadToEnd(); $sr.Close()
  $ns2 = New-Object Xml.XmlNamespaceManager($xml.NameTable)
  $ns2.AddNamespace('m', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main')
  $rowNodes = $xml.SelectNodes('//m:sheetData/m:row', $ns2)
  for ($ri = 2; $ri -lt [Math]::Min(12, $rowNodes.Count); $ri++) {
    $row = $rowNodes[$ri]
    $map = @{}
    foreach ($c in $row.SelectNodes('m:c', $ns2)) {
      $ref = $c.GetAttribute('r')
      if ($ref -match '^([A-Z]+)([0-9]+)$') {
        $col = Col-ToIndex $matches[1]
        $vNode = $c.SelectSingleNode('m:v', $ns2)
        $val = ''
        if ($vNode) {
          if ($c.GetAttribute('t') -eq 's') { $val = $shared[[int]$vNode.InnerText] }
          else { $val = $vNode.InnerText }
        }
        $map[$col] = $val
      }
    }
    foreach ($start in @(0, 4, 8)) {
      $prop = [string]$map[$start]
      if (-not $prop.Trim()) { continue }
      $phone = [string]$map[($start + 1)]
      $status = [string]$map[($start + 2)]
      Write-Output ("Row {0} group {1}: {2} | {3} | {4}" -f ($ri + 1), ($start / 4 + 1), $prop, $phone, $status)
    }
  }
}
$zip.Dispose()
