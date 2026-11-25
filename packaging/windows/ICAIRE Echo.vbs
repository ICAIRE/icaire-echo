' ICAIRE Echo for Windows. Starts the app without a window of its own and opens it in the browser; when it is
' already running, the app only opens it. Your recordings, voice-overs, models and the bot's sign-in are kept in
' %APPDATA%\ICAIRE Echo, so a new version never touches them. "Quit ICAIRE Echo" under More in the app ends it.
Option Explicit
Dim sh, fso, here, data, logs, old, d, env, q
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
here = fso.GetParentFolderName(WScript.ScriptFullName)
data = sh.ExpandEnvironmentStrings("%APPDATA%") & "\ICAIRE Echo"
If Not fso.FolderExists(data) Then fso.CreateFolder data
logs = data & "\logs"
If Not fso.FolderExists(logs) Then fso.CreateFolder logs

' once: bring over what the earlier Meet Recorder kept in %LOCALAPPDATA%\Meet Recorder
old = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Meet Recorder"
For Each d In Array("recordings", "voiceovers", "models", "bot-profile")
  If fso.FolderExists(old & "\" & d) And Not fso.FolderExists(data & "\" & d) Then
    On Error Resume Next
    fso.MoveFolder old & "\" & d, data & "\" & d
    On Error GoTo 0
  End If
Next

Set env = sh.Environment("Process")
env("ECHO_DATA") = data
env("ECHO_PACKAGED") = "1"
env("MRB_BACKGROUND") = "1"
sh.CurrentDirectory = here & "\app"
q = Chr(34)
' cmd /c ""...\node.exe" server.js >> "...\echo.log" 2>&1", hidden, not waited for
sh.Run "cmd /c " & q & q & here & "\node.exe" & q & " server.js >> " & q & logs & "\echo.log" & q & " 2>&1" & q, 0, False
