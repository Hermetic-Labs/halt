# Simulates the sendAnnouncement() button flow from TaskBoard.tsx
$msg = "All medics report to ward alpha immediately"
Write-Host "=== ANNOUNCEMENT FLOW ===" -ForegroundColor Yellow
Write-Host "Message: $msg"

# Step 1: Translate to Spanish (simulating one active language)
Write-Host "`n--- Step 1: Translate en->es ---" -ForegroundColor Cyan
$tr = Invoke-RestMethod -Uri "http://localhost:7779/api/translate" -Method POST `
    -ContentType "application/json" `
    -Body "{`"text`":`"$msg`",`"source`":`"en`",`"target`":`"es`"}"
Write-Host "Spanish: $($tr.translated)"

# Step 2: TTS multi-segment (English + Spanish)
Write-Host "`n--- Step 2: TTS synthesize-multi ---" -ForegroundColor Cyan
$ttsBody = @{
    segments = @(
        @{ text = "Attention. $msg"; lang = "en" }
        @{ text = "Atencion. $($tr.translated)"; lang = "es" }
    )
    speed = 1.0
} | ConvertTo-Json -Depth 3
$tts = Invoke-RestMethod -Uri "http://localhost:7779/tts/synthesize-multi" -Method POST `
    -ContentType "application/json" -Body $ttsBody
$audioLen = if($tts.audio_base64) { $tts.audio_base64.Length } else { 0 }
Write-Host "Audio: $audioLen chars base64, Duration: $($tts.duration_ms)ms"

# Step 3: Broadcast announcement
Write-Host "`n--- Step 3: POST /mesh/announcement ---" -ForegroundColor Cyan
$annBody = @{
    message = $msg
    sender_name = "TestMedic"
    audio_base64 = if($tts.audio_base64) { $tts.audio_base64 } else { "" }
    translations = @{ es = $tr.translated }
    sound = ""
} | ConvertTo-Json -Depth 3
$ann = Invoke-RestMethod -Uri "http://localhost:7779/mesh/announcement" -Method POST `
    -ContentType "application/json" -Body $annBody
Write-Host "Response:" ($ann | ConvertTo-Json -Depth 3)

# Play the audio
if($tts.audio_base64) {
    $raw = $tts.audio_base64 -replace '^data:audio/wav;base64,',''
    [System.IO.File]::WriteAllBytes("c:\Halt\test_announcement.wav", [System.Convert]::FromBase64String($raw))
    Write-Host "`n=== PLAYING ANNOUNCEMENT ===" -ForegroundColor Green
    Start-Process "c:\Halt\test_announcement.wav"
}
