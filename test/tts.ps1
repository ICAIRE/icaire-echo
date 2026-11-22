# Renders text-to-speech clips: node passes a JSON file of [{ voice, text, file }].
# Voices from the Windows OneCore set (George, Susan, Naayf...) or the older desktop set (Zira, Hazel).
param([string]$jobs)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
Add-Type -AssemblyName System.Runtime.WindowsRuntime
[void][Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
[void][Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]

$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
} | Select-Object -First 1
function Wait-Op($op, [Type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$task.Wait()
  $task.Result
}

$oneCore = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$desktop = New-Object System.Speech.Synthesis.SpeechSynthesizer
$desktopNames = $desktop.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }

foreach ($j in (Get-Content -Raw -Encoding UTF8 $jobs | ConvertFrom-Json)) {
  $desk = $desktopNames | Where-Object { $_ -like "*$($j.voice)*" } | Select-Object -First 1
  if ($desk) {
    $desktop.SelectVoice($desk)
    $desktop.SetOutputToWaveFile($j.file)
    $desktop.Speak($j.text)
    $desktop.SetOutputToNull()
    continue
  }
  $v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -like "*$($j.voice)*" } | Select-Object -First 1
  if (-not $v) { throw "voice not installed: $($j.voice)" }
  $oneCore.Voice = $v
  $stream = Wait-Op ($oneCore.SynthesizeTextToStreamAsync($j.text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
  [void](Wait-Op ($reader.LoadAsync([uint32]$stream.Size)) ([uint32]))
  $bytes = New-Object byte[] $stream.Size
  $reader.ReadBytes($bytes)
  [IO.File]::WriteAllBytes($j.file, $bytes)
  $reader.Dispose()
  $stream.Dispose()
}
$desktop.Dispose()
