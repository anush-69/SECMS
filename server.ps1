param(
  [int]$Port = 3000
)

$ErrorActionPreference = "Stop"
$Root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
$RootWithSlash = $Root.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar

$State = [ordered]@{
  patients = @(
    [ordered]@{
      id = "mary"; name = "Mary Perera"; age = 78; initials = "MP"; risk = "High"; condition = "Hypertension watch"; location = "Colombo 07"; heart = 78; fallRisk = 24; bodyTemp = 36.8; deviceId = "SECMS-ESP32-001";
      contacts = @(
        [ordered]@{ name = "Nimal Perera"; relation = "Son"; phone = "+94 77 123 4567"; email = "nimal@example.com" },
        [ordered]@{ name = "Dr. Silva"; relation = "Physician"; phone = "+94 11 222 3344"; email = "care@example.com" }
      )
    },
    [ordered]@{
      id = "anil"; name = "Anil Fernando"; age = 82; initials = "AF"; risk = "Medium"; condition = "Mobility support"; location = "Nugegoda"; heart = 86; fallRisk = 18; bodyTemp = 37.1; deviceId = "SECMS-ESP32-002";
      contacts = @(
        [ordered]@{ name = "Maya Fernando"; relation = "Daughter"; phone = "+94 76 222 4577"; email = "maya@example.com" },
        [ordered]@{ name = "Care Desk"; relation = "Care team"; phone = "+94 11 888 0199"; email = "desk@example.com" }
      )
    }
  )
  alerts = @(
    [ordered]@{ id = 1; severity = "critical"; title = "Fall detected near home entrance"; person = "Mary Perera"; time = "2 min ago"; status = "New"; detail = "MPU6050 impact pattern crossed sensitivity threshold. SMS sent." },
    [ordered]@{ id = 2; severity = "warning"; title = "Heart rate above normal band"; person = "Anil Fernando"; time = "18 min ago"; status = "Acknowledged"; detail = "Heart rate peaked at 104 bpm for 3 minutes." },
    [ordered]@{ id = 3; severity = "resolved"; title = "GPS signal restored"; person = "Mary Perera"; time = "1 hr ago"; status = "Resolved"; detail = "NEO-6M reacquired a stable location lock." }
  )
  devices = @(
    [ordered]@{ id = "SECMS-ESP32-001"; name = "Mary bedside unit"; owner = "Mary Perera"; status = "Online"; battery = 84; last = "Just now"; signal = 96 },
    [ordered]@{ id = "SECMS-ESP32-002"; name = "Anil wearable node"; owner = "Anil Fernando"; status = "Online"; battery = 68; last = "1 min ago"; signal = 88 },
    [ordered]@{ id = "SECMS-ESP32-003"; name = "Spare test unit"; owner = "Unassigned"; status = "Offline"; battery = 23; last = "2 days ago"; signal = 0 }
  )
  config = [ordered]@{ highHeartRate = 110; lowHeartRate = 55; fallSensitivity = 72; voiceAlerts = $false }
}

$Mime = @{
  ".html" = "text/html; charset=utf-8"
  ".css" = "text/css; charset=utf-8"
  ".js" = "application/javascript; charset=utf-8"
  ".json" = "application/json; charset=utf-8"
  ".png" = "image/png"
  ".jpg" = "image/jpeg"
  ".jpeg" = "image/jpeg"
}

function Write-Response($Stream, [int]$Status, [string]$ContentType, [byte[]]$Body) {
  $Reason = switch ($Status) {
    200 { "OK" }
    201 { "Created" }
    404 { "Not Found" }
    default { "OK" }
  }
  $Header = "HTTP/1.1 $Status $Reason`r`nContent-Type: $ContentType`r`nContent-Length: $($Body.Length)`r`nCache-Control: no-store`r`nConnection: close`r`n`r`n"
  $HeaderBytes = [System.Text.Encoding]::ASCII.GetBytes($Header)
  $Stream.Write($HeaderBytes, 0, $HeaderBytes.Length)
  $Stream.Write($Body, 0, $Body.Length)
}

function Write-Json($Stream, $Payload, [int]$Status = 200) {
  $Json = $Payload | ConvertTo-Json -Depth 8
  $Body = [System.Text.Encoding]::UTF8.GetBytes($Json)
  Write-Response $Stream $Status "application/json; charset=utf-8" $Body
}

function Read-Request($Stream) {
  $Buffer = New-Object byte[] 65536
  $Builder = New-Object System.Collections.Generic.List[byte]
  do {
    $Read = $Stream.Read($Buffer, 0, $Buffer.Length)
    for ($Index = 0; $Index -lt $Read; $Index++) {
      $Builder.Add($Buffer[$Index])
    }
    $Text = [System.Text.Encoding]::UTF8.GetString($Builder.ToArray())
    $HeaderEnd = $Text.IndexOf("`r`n`r`n")
    if ($HeaderEnd -ge 0) {
      $HeaderText = $Text.Substring(0, $HeaderEnd)
      $Match = [regex]::Match($HeaderText, "Content-Length:\s*(\d+)", "IgnoreCase")
      $ContentLength = if ($Match.Success) { [int]$Match.Groups[1].Value } else { 0 }
      $BodyBytesRead = $Builder.Count - ($HeaderEnd + 4)
      if ($BodyBytesRead -ge $ContentLength) {
        return $Text
      }
    }
  } while ($Read -gt 0 -and $Stream.DataAvailable)
  return [System.Text.Encoding]::UTF8.GetString($Builder.ToArray())
}

function Get-BodyJson([string]$RequestText) {
  $HeaderEnd = $RequestText.IndexOf("`r`n`r`n")
  if ($HeaderEnd -lt 0) {
    return @{}
  }
  $Body = $RequestText.Substring($HeaderEnd + 4).Trim()
  if ([string]::IsNullOrWhiteSpace($Body)) {
    return @{}
  }
  return $Body | ConvertFrom-Json
}

function Update-SimulatedVitals {
  foreach ($Patient in $State.patients) {
    $Patient.heart = [Math]::Max(54, [Math]::Min(118, $Patient.heart + (Get-Random -Minimum -2 -Maximum 3)))
    $Patient.fallRisk = [Math]::Max(8, [Math]::Min(85, $Patient.fallRisk + (Get-Random -Minimum -1 -Maximum 2)))
    $Patient.bodyTemp = [Math]::Round([Math]::Max(35.5, [Math]::Min(39.5, $Patient.bodyTemp + (Get-Random -Minimum -0.1 -Maximum 0.11))), 1)
  }
}

$Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
$Listener.Start()
Write-Host "SECMS PowerShell backend running at http://localhost:$Port"

try {
  while ($true) {
    $Client = $Listener.AcceptTcpClient()
    try {
      $Stream = $Client.GetStream()
      $RequestText = Read-Request $Stream
      $FirstLine = ($RequestText -split "`r`n")[0]
      $Parts = $FirstLine -split " "
      if ($Parts.Count -lt 2) {
        Write-Json $Stream ([ordered]@{ error = "Bad request" }) 404
        continue
      }

      $Method = $Parts[0]
      $RequestPath = ([System.Uri]::UnescapeDataString($Parts[1]) -split "\?")[0]

      if ($RequestPath -eq "/api/state" -and $Method -eq "GET") {
        Update-SimulatedVitals
        Write-Json $Stream $State
        continue
      }

      if ($RequestPath -eq "/api/alerts" -and $Method -eq "POST") {
        $Body = Get-BodyJson $RequestText
        $Alert = [ordered]@{
          id = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
          severity = if ($Body.severity) { $Body.severity } else { "warning" }
          title = if ($Body.title) { $Body.title } else { "Care alert" }
          person = if ($Body.person) { $Body.person } else { "Unknown" }
          time = "Just now"
          status = "New"
          detail = if ($Body.detail) { $Body.detail } else { "Alert received by backend simulator." }
        }
        $State.alerts = @($Alert) + $State.alerts
        Write-Json $Stream ([ordered]@{ ok = $true; alert = $Alert }) 201
        continue
      }

      if ($RequestPath -eq "/api/config" -and $Method -eq "POST") {
        $Body = Get-BodyJson $RequestText
        foreach ($Name in $Body.PSObject.Properties.Name) {
          $State.config[$Name] = $Body.$Name
        }
        $State.config.updatedAt = [DateTimeOffset]::UtcNow.ToString("o")
        Write-Json $Stream ([ordered]@{ ok = $true; config = $State.config })
        continue
      }

      $Relative = if ($RequestPath -eq "/") { "index.html" } else { $RequestPath.TrimStart("/") }
      $FilePath = [System.IO.Path]::GetFullPath((Join-Path $Root $Relative))
      if (-not $FilePath.StartsWith($RootWithSlash, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path -LiteralPath $FilePath -PathType Leaf)) {
        Write-Json $Stream ([ordered]@{ error = "Not found" }) 404
        continue
      }

      $Ext = [System.IO.Path]::GetExtension($FilePath).ToLowerInvariant()
      $ContentType = if ($Mime.ContainsKey($Ext)) { $Mime[$Ext] } else { "application/octet-stream" }
      $Bytes = [System.IO.File]::ReadAllBytes($FilePath)
      Write-Response $Stream 200 $ContentType $Bytes
    }
    finally {
      $Client.Close()
    }
  }
}
finally {
  $Listener.Stop()
}
