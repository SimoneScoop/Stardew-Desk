$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$requests = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -ReferencedAssemblies System.Drawing -TypeDefinition @'
using System;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;

public static class StardewShortcutIcon {
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern uint ExtractIconEx(string file, int index, out IntPtr large, out IntPtr small, uint count);
    [DllImport("user32.dll")]
    private static extern bool DestroyIcon(IntPtr icon);

    public static string Read(string file, int index) {
        IntPtr large = IntPtr.Zero, small = IntPtr.Zero;
        try {
            if (ExtractIconEx(file, index, out large, out small, 1) == 0) return null;
            IntPtr handle = large != IntPtr.Zero ? large : small;
            if (handle == IntPtr.Zero) return null;
            using (Icon icon = Icon.FromHandle(handle))
            using (Bitmap bitmap = icon.ToBitmap())
            using (MemoryStream stream = new MemoryStream()) {
                bitmap.Save(stream, ImageFormat.Png);
                return "data:image/png;base64," + Convert.ToBase64String(stream.ToArray());
            }
        } catch { return null; }
        finally {
            if (large != IntPtr.Zero) DestroyIcon(large);
            if (small != IntPtr.Zero && small != large) DestroyIcon(small);
        }
    }
}
'@
$result = @{}
foreach ($request in $requests) {
    foreach ($source in $request.sources) {
        $png = [StardewShortcutIcon]::Read([string]$source.file, [int]$source.index)
        if ($png) { $result[[string]$request.key] = $png; break }
    }
}
$result | ConvertTo-Json -Compress
