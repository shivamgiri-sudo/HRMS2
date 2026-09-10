Add-Type -AssemblyName System.IO.Compression.FileSystem

function Get-SheetXml($zip, $sheetName) {
    $wbEntry = $zip.GetEntry("xl/workbook.xml")
    $wbXml = [xml](New-Object System.IO.StreamReader($wbEntry.Open())).ReadToEnd()
    $relsEntry = $zip.GetEntry("xl/_rels/workbook.xml.rels")
    $relsXml = [xml](New-Object System.IO.StreamReader($relsEntry.Open())).ReadToEnd()

    $sheetNode = $wbXml.workbook.sheets.sheet | Where-Object { $_.name -eq $sheetName }
    if (-not $sheetNode) { return $null }
    $rid = $sheetNode.id
    $rel = $relsXml.Relationships.Relationship | Where-Object { $_.Id -eq $rid }
    $target = $rel.Target -replace '^/', ''
    if ($target -notmatch '^xl/') { $target = "xl/$target" }
    $sheetEntry = $zip.GetEntry($target)
    return [xml](New-Object System.IO.StreamReader($sheetEntry.Open())).ReadToEnd()
}

function Get-SharedStrings($zip) {
    $entry = $zip.GetEntry("xl/sharedStrings.xml")
    if (-not $entry) { return @() }
    $xml = [xml](New-Object System.IO.StreamReader($entry.Open())).ReadToEnd()
    $out = New-Object System.Collections.Generic.List[string]
    foreach ($si in $xml.sst.si) {
        if ($si.t -ne $null) {
            $out.Add([string]$si.t)
        } elseif ($si.r) {
            $text = ""
            foreach ($r in $si.r) { $text += $r.t }
            $out.Add($text)
        } else {
            $out.Add("")
        }
    }
    return $out
}

function Col-Letters-To-Index($ref) {
    if ($ref -match '^([A-Z]+)') {
        $letters = $matches[1]
        $idx = 0
        foreach ($c in $letters.ToCharArray()) {
            $idx = $idx * 26 + ([int][char]$c - [int][char]'A' + 1)
        }
        return $idx - 1
    }
    return -1
}

function Parse-Sheet($sheetXml, $sharedStrings) {
    $rows = @()
    foreach ($row in $sheetXml.worksheet.sheetData.row) {
        $cells = @{}
        $maxCol = -1
        if ($row.c -eq $null) { continue }
        foreach ($c in $row.c) {
            $colIdx = Col-Letters-To-Index $c.r
            if ($colIdx -gt $maxCol) { $maxCol = $colIdx }
            $val = $null
            if ($c.v -ne $null) {
                if ($c.t -eq "s") {
                    $si = [int]$c.v
                    $val = $sharedStrings[$si]
                } elseif ($c.t -eq "str" -or $c.t -eq "inlineStr") {
                    $val = [string]$c.v
                } else {
                    $val = [string]$c.v
                }
            }
            $cells[$colIdx] = $val
        }
        $rowArr = New-Object object[] ($maxCol + 1)
        foreach ($k in $cells.Keys) { $rowArr[$k] = $cells[$k] }
        $rows += , $rowArr
    }
    return $rows
}

$files = @(
    @{ Path = "C:\Users\ADMIN\Downloads\Lp  Regional Sale Dashboard July26.xlsx"; Tag = "regional" },
    @{ Path = "C:\Users\ADMIN\Downloads\Lp Non Regional Dashboard July'26.xlsx"; Tag = "non_regional" }
)
$sheets = @{ "Leads" = "leads"; "APR" = "apr"; "CR Report" = "cr_report" }

foreach ($f in $files) {
    Write-Output "=== $($f.Tag) ==="
    $zip = [System.IO.Compression.ZipFile]::OpenRead($f.Path)
    $sharedStrings = Get-SharedStrings $zip
    foreach ($sheetName in $sheets.Keys) {
        $outKey = $sheets[$sheetName]
        $sheetXml = Get-SheetXml $zip $sheetName
        if (-not $sheetXml) { Write-Output "  $sheetName not found"; continue }
        $rows = Parse-Sheet $sheetXml $sharedStrings
        if ($rows.Count -eq 0) { Write-Output "  $sheetName empty"; continue }
        $header = $rows[0]
        $records = @()
        for ($i = 1; $i -lt $rows.Count; $i++) {
            $r = $rows[$i]
            $hasData = $false
            foreach ($v in $r) { if ($v -ne $null -and "$v".Trim() -ne "") { $hasData = $true; break } }
            if (-not $hasData) { continue }
            $rec = [ordered]@{}
            for ($j = 0; $j -lt $header.Count; $j++) {
                $key = if ($header[$j] -ne $null) { ("$($header[$j])" -replace ' ', '_') } else { "col$j" }
                $rec[$key] = if ($j -lt $r.Count) { $r[$j] } else { $null }
            }
            $records += $rec
        }
        $outPath = "C:\Users\ADMIN\Desktop\HRMS2-latest\backend\scripts\_lp_$($f.Tag)_$outKey.json"
        $records | ConvertTo-Json -Depth 5 | Out-File -FilePath $outPath -Encoding utf8
        Write-Output "  $sheetName -> $($records.Count) rows -> $outPath"
    }
    $zip.Dispose()
}
Write-Output "DONE"
