import os,runpy
runpy.run_path('cloud_worker.py' if os.getenv('WORKER_MODE')=='cloud' else 'worker.py',run_name='__main__')
