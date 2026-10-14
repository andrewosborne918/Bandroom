"""Run in a Python 3.11 environment with FFmpeg and requirements-build installed."""
import os,pathlib,shutil,subprocess,sys
repo=pathlib.Path(__file__).resolve().parents[2]
worker=repo/'worker';desktop=repo/'desktop';runtime=desktop/'src-tauri'/'runtime'
ffmpeg=desktop/'build'/'ffmpeg-bin'
args=[sys.executable,'-m','PyInstaller','--noconfirm','--clean','--onedir','--name','bndrm-processor','--distpath',str(runtime),'--workpath',str(desktop/'build'),'--specpath',str(desktop/'build'),'--paths',str(worker)]
for module in ('demucs','whisper','librosa','soundfile','torchaudio','numba','llvmlite','requests'):
 args+=['--collect-all',module]
args+=['--collect-submodules','torch','--hidden-import','analyze','--hidden-import','cloud_worker','--hidden-import','worker']
for name in ('ffmpeg','ffprobe'):
 binary=str(ffmpeg/(name+('.exe' if os.name=='nt' else ''))) if ffmpeg.exists() else shutil.which(name)
 if not binary:raise RuntimeError(f'{name} must be installed in the build environment')
 args+=['--add-binary',binary+os.pathsep+'ffmpeg']
args+=[str(worker/'desktop_processor.py')]
subprocess.check_call(args,cwd=repo)
exe=runtime/'bndrm-processor'/('bndrm-processor.exe' if os.name=='nt' else 'bndrm-processor')
subprocess.check_call([str(exe),'--self-test'])

# Ship the exact FFmpeg source/configuration and all installed Python license notices.
import importlib.metadata
notices=runtime/'bndrm-processor'/'third-party-notices';notices.mkdir(exist_ok=True)
for distribution in importlib.metadata.distributions():
 name=distribution.metadata.get('Name','dependency')
 folder=notices/name;folder.mkdir(exist_ok=True)
 (folder/'METADATA.txt').write_text(distribution.read_text('METADATA') or (name+' '+distribution.version),encoding='utf-8')
 for file in distribution.files or []:
  if any(part.upper().startswith(('LICENSE','LICENCE','COPYING','NOTICE')) for part in file.parts):
   original=distribution.locate_file(file)
   if original.is_file():
    relative=folder/str(file).replace('..','_').replace('\\','__').replace('/','__')
    relative.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(original,relative)
source=desktop/'build'/'ffmpeg-source'
if source.exists():shutil.copytree(source,notices/'ffmpeg',dirs_exist_ok=True)
