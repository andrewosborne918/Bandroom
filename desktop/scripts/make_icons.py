"""Package the supplied Bndrm monogram into native application icon formats."""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parents[1]
icons = root / 'src-tauri' / 'icons'
icons.mkdir(exist_ok=True)
im = Image.open(root / 'frontend' / 'branding' / 'bndrm-icon.png').convert('RGBA').resize((1024, 1024), Image.Resampling.LANCZOS)
im.save(icons / 'icon.png')
im.save(icons / 'icon.ico', sizes=[(16,16),(32,32),(48,48),(128,128),(256,256)])
im.save(icons / 'icon.icns')
