"""Build a minimal LGPL FFmpeg with native WAV/MP3/M4A/AAC decoding and no external codecs."""
import hashlib,json,os,pathlib,shutil,subprocess,tarfile,urllib.request
root=pathlib.Path(__file__).resolve().parents[1]/'build';root.mkdir(exist_ok=True)
archive=root/'ffmpeg-7.1.1.tar.xz';expected='733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1'
if not archive.exists():
 with urllib.request.urlopen('https://ffmpeg.org/releases/'+archive.name,timeout=120) as response,archive.open('wb') as out:shutil.copyfileobj(response,out)
if hashlib.sha256(archive.read_bytes()).hexdigest()!=expected:raise RuntimeError('FFmpeg source checksum mismatch')
source=root/'ffmpeg-7.1.1'
if not source.exists():
 with tarfile.open(archive) as tar:tar.extractall(root,filter='data')
args=['--disable-autodetect','--disable-gpl','--disable-nonfree','--disable-version3','--disable-everything','--disable-doc','--disable-debug','--disable-network','--disable-x86asm','--enable-static','--disable-shared','--enable-ffmpeg','--enable-ffprobe','--enable-avcodec','--enable-avformat','--enable-avfilter','--enable-swresample','--enable-protocol=file,pipe','--enable-demuxer=wav,mp3,mov,aac,flac','--enable-decoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le,mp3,mp3float,aac,flac','--enable-parser=aac,mpegaudio,flac','--enable-encoder=pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,flac','--enable-muxer=wav,null,s16le,f32le,flac','--enable-filter=aresample,aformat,anull,atrim,asetpts']
if os.name=='nt':args+=['--toolchain=msvc']
bash=shutil.which('bash')
if not bash:raise RuntimeError('A build shell is required')
# Use the same shell for configure and make; Git Bash/MSYS resolves make and MSVC on Windows.
subprocess.check_call([bash,'./configure',*args],cwd=source)
subprocess.check_call([bash,'-c',f'make -j{min(4,os.cpu_count() or 1)} ffmpeg ffprobe'],cwd=source)
out=root/'ffmpeg-bin';out.mkdir(exist_ok=True)
for name in ('ffmpeg','ffprobe'):
 executable=name+('.exe' if os.name=='nt' else '')
 shutil.copy2(source/executable,out/executable)
notices=root/'ffmpeg-source';notices.mkdir(exist_ok=True)
shutil.copy2(archive,notices/archive.name)
for file in ('COPYING.LGPLv2.1','LICENSE.md'):shutil.copy2(source/file,notices/file)
(notices/'BUILD.json').write_text(json.dumps({'source':'https://ffmpeg.org/releases/'+archive.name,'sha256':expected,'configure':args,'toolchain':os.name},indent=2))
print('Minimal FFmpeg built, with exact source and license bundled for redistribution.')
