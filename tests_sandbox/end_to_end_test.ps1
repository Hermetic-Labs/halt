$langs = "ar", "zh", "am", "ru", "es", "fa", "ko", "th", "hi"

foreach ($lang in $langs) {
    Write-Host "`n=== Testing $lang ==="
    
    # 1. Translate
    $payload1 = @{
        text = "All medics report to ward alpha immediately"
        source = "en"
        target = $lang
    } | ConvertTo-Json
    
    try {
        $res1 = Invoke-RestMethod -Uri "http://127.0.0.1:7778/api/translate" -Method POST -Body $payload1 -ContentType "application/json"
        Write-Host "Translation: $($res1.translated)"
        
        # 2. TTS Single
        $payload2 = @{
            text = $res1.translated
            lang = $lang
            speed = 1.0
            voice = "af_heart"
        } | ConvertTo-Json
        
        $res2 = Invoke-RestMethod -Uri "http://127.0.0.1:7778/tts/synthesize" -Method POST -Body $payload2 -ContentType "application/json"
        Write-Host "TTS Single Audio Size: $($res2.audio_base64.Length)"
        
        # 3. TTS Multi
        $payload3 = @{
            segments = @(
                @{ text = $res1.translated; lang = $lang }
            )
            speed = 1.0
        } | ConvertTo-Json -Depth 5
        
        $res3 = Invoke-RestMethod -Uri "http://127.0.0.1:7778/tts/synthesize-multi" -Method POST -Body $payload3 -ContentType "application/json"
        Write-Host "TTS Multi Audio Size: $($res3.audio_base64.Length)"
        
    } catch {
        Write-Host "CRASH on $lang : $_"
    }
}
