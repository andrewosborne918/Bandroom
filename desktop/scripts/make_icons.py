from pathlib import Path
from PIL import Image,ImageDraw
root=Path(__file__).resolve().parents[1]/'src-tauri'/'icons';root.mkdir(exist_ok=True)
im=Image.new('RGBA',(1024,1024),(13,16,23,255));d=ImageDraw.Draw(im)
for x,height in [(236,180),(370,380),(504,570),(638,260),(772,440)]:d.rounded_rectangle((x-34,512-height//2,x+34,512+height//2),radius=34,fill=(255,149,94,255))
im.save(root/'icon.png');im.save(root/'icon.ico',sizes=[(16,16),(32,32),(48,48),(128,128),(256,256)]);im.save(root/'icon.icns')
