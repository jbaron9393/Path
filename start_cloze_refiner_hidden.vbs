Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "cmd /c start_cloze_refiner.bat", 0
Set WshShell = Nothing
