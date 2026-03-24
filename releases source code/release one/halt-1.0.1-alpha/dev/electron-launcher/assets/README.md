# HALT Launcher Assets

Place the following icon files in this directory:

## Required Files

- `icon.png` - 512x512 PNG (used for Linux and as source)
- `icon.ico` - Windows icon (16x16, 32x32, 48x48, 256x256)
- `icon.icns` - macOS icon (16x16 to 1024x1024)
- `tray-icon.png` - 16x16 or 22x22 PNG for system tray

## Generating Icons

You can use tools like:

- <https://www.iconifier.net/> - Convert PNG to ICO/ICNS
- <https://cloudconvert.com/png-to-ico>
- ImageMagick CLI: `convert icon.png -define icon:auto-resize=256,128,64,48,32,16 icon.ico`

## Brand Colors

- Primary Green: #00FF88
- Primary Blue: #00D4FF
- Dark Background: #0A0A0A
- Text: #FFFFFF
