# Simulate: connect as WS client, send an announcement, verify it arrives back
# This proves the full chain: HTTP → alerts.rs → ws_listener → WS client

$ws = [System.Net.WebSockets.ClientWebSocket]::new()
$uri = [System.Uri]::new("ws://127.0.0.1:7778/ws/test-trace-client")
$ct = [System.Threading.CancellationToken]::None

Write-Host "=== ANNOUNCEMENT TRACE ===" -ForegroundColor Yellow
Write-Host ""

# Step 1: Connect WS
Write-Host "[1] Connecting WebSocket to :7778..." -ForegroundColor Cyan
$ws.ConnectAsync($uri, $ct).Wait()
Write-Host "    -> Connected: $($ws.State)" -ForegroundColor Green

# Step 2: Set name
$setName = '{"type":"set_name","name":"TraceBot","role":"responder"}'
$bytes = [System.Text.Encoding]::UTF8.GetBytes($setName)
$ws.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, $ct).Wait()
Write-Host "[2] Set name: TraceBot" -ForegroundColor Cyan

# Read sync message
$buf = [byte[]]::new(65536)
$result = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf), $ct).Result
$syncMsg = [System.Text.Encoding]::UTF8.GetString($buf, 0, $result.Count)
$syncObj = $syncMsg | ConvertFrom-Json
Write-Host "    -> Sync received: type=$($syncObj.type), clients=$($syncObj.clients)" -ForegroundColor DarkGray

# Step 3: Send announcement via HTTP
Write-Host ""
Write-Host "[3] Sending announcement via HTTP POST /mesh/announcement..." -ForegroundColor Cyan
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$annBody = '{"message":"Trace test announcement","sender_name":"TraceBot","audio_base64":"","translations":{"es":"Prueba de rastreo"},"sound":""}'
$annResult = Invoke-RestMethod -Uri "http://localhost:7779/mesh/announcement" -Method POST -ContentType "application/json" -Body $annBody
$sw.Stop()
Write-Host "    -> Server responded in $($sw.ElapsedMilliseconds)ms" -ForegroundColor Green
Write-Host "    -> type=$($annResult.type), message=$($annResult.message)" -ForegroundColor Green

# Step 4: Listen for WS broadcast
Write-Host ""
Write-Host "[4] Waiting for WebSocket broadcast..." -ForegroundColor Cyan
$received = $false
$timeout = [System.Threading.CancellationTokenSource]::new(5000)
try {
    $buf2 = [byte[]]::new(1048576)  # 1MB for audio payload
    $result2 = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf2), $timeout.Token).Result
    $wsMsg = [System.Text.Encoding]::UTF8.GetString($buf2, 0, $result2.Count)
    $wsObj = $wsMsg | ConvertFrom-Json
    $received = $true
    
    Write-Host "    -> RECEIVED! type=$($wsObj.type)" -ForegroundColor Green
    Write-Host "    -> message: $($wsObj.message)" -ForegroundColor Green
    Write-Host "    -> sender: $($wsObj.sender_name)" -ForegroundColor Green
    Write-Host "    -> translations: $(($wsObj.translations | ConvertTo-Json -Compress))" -ForegroundColor Green
    
    $audioLen = if($wsObj.audio_base64) { $wsObj.audio_base64.Length } else { 0 }
    $audioB64Len = if($wsObj.audio_b64) { $wsObj.audio_b64.Length } else { 0 }
    Write-Host "    -> audio_base64: $audioLen chars" -ForegroundColor $(if($audioLen -gt 0){"Green"}else{"Red"})
    Write-Host "    -> audio_b64: $audioB64Len chars (legacy)" -ForegroundColor DarkGray
    
    # Check for more messages (client_joined etc)
    while($true) {
        try {
            $timeout2 = [System.Threading.CancellationTokenSource]::new(1000)
            $result3 = $ws.ReceiveAsync([ArraySegment[byte]]::new($buf2), $timeout2.Token).Result
            $extra = [System.Text.Encoding]::UTF8.GetString($buf2, 0, $result3.Count)
            $extraObj = $extra | ConvertFrom-Json
            Write-Host "    -> (extra msg: type=$($extraObj.type))" -ForegroundColor DarkGray
        } catch { break }
    }
} catch {
    Write-Host "    -> TIMEOUT: No WebSocket message received in 5s!" -ForegroundColor Red
    Write-Host "    -> broadcast_message() is NOT reaching WS clients" -ForegroundColor Red
}

# Cleanup
$ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "", $ct).Wait()

Write-Host ""
Write-Host "=== VERDICT ===" -ForegroundColor Yellow
if ($received) {
    if ($audioLen -gt 0) {
        Write-Host "PASS: WS broadcast arrives WITH audio" -ForegroundColor Green
    } else {
        Write-Host "PARTIAL: WS broadcast arrives but NO audio (audio_base64 empty)" -ForegroundColor Yellow
        Write-Host "  -> The receiver will fall back to live fetchTTSAudio()" -ForegroundColor Yellow
    }
} else {
    Write-Host "FAIL: WS broadcast never arrived" -ForegroundColor Red
}
