"""Nightly operator-only streamed DB + private-object backup. Never run in the browser."""
import os,json,datetime,hashlib,subprocess,tempfile,urllib.parse
import requests,boto3
from boto3.s3.transfer import TransferConfig
class HashedReader:
    def __init__(self,source):self.source=source;self.digest=hashlib.sha256();self.size=0
    def read(self,size=-1):
        chunk=self.source.read(size);self.digest.update(chunk);self.size+=len(chunk);return chunk
base=os.environ['NEXT_PUBLIC_SUPABASE_URL'].rstrip('/')
headers={'apikey':os.environ['SUPABASE_SERVICE_ROLE_KEY'],'Authorization':'Bearer '+os.environ['SUPABASE_SERVICE_ROLE_KEY']}
s3=boto3.client('s3',endpoint_url=os.environ['BACKUP_S3_ENDPOINT'],aws_access_key_id=os.environ['BACKUP_ACCESS_KEY_ID'],aws_secret_access_key=os.environ['BACKUP_SECRET_ACCESS_KEY'])
bucket=os.environ['BACKUP_S3_BUCKET'];prefix=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H-%M-%SZ')+'/'
config=TransferConfig(multipart_threshold=8*1024*1024,multipart_chunksize=8*1024*1024,use_threads=False)
manifest={'format':1,'createdAt':prefix[:-1],'supabaseOrigin':base,'objects':[],'databaseSchemas':['public','auth'],'restoreWarning':'Managed Auth schema restoration needs Supabase-compatible recovery. Test in an isolated project.'}
def save(stream,key):
    reader=HashedReader(stream);s3.upload_fileobj(reader,bucket,prefix+key,Config=config,ExtraArgs={'ServerSideEncryption':'AES256'});return {'backupKey':prefix+key,'bytes':reader.size,'sha256':reader.digest.hexdigest()}
def entries(storage_bucket,p=''):
    offset=0
    while True:
        r=requests.post(base+'/storage/v1/object/list/'+storage_bucket,headers=headers,json={'prefix':p,'limit':100,'offset':offset,'sortBy':{'column':'name','order':'asc'}},timeout=120);r.raise_for_status();rows=r.json()
        for row in rows:
            name=(p+'/' if p else '')+row['name']
            if row.get('id') is None:yield from entries(storage_bucket,name)
            else:yield name
        if len(rows)<100:return
        offset+=len(rows)
# Avoid a database password in command-line arguments or logs.
url=urllib.parse.urlparse(os.environ['DATABASE_URL']);env={**os.environ,'PGHOST':url.hostname,'PGPORT':str(url.port or 5432),'PGUSER':urllib.parse.unquote(url.username or ''),'PGPASSWORD':urllib.parse.unquote(url.password or ''),'PGDATABASE':url.path.lstrip('/'),'PGSSLMODE':dict(urllib.parse.parse_qsl(url.query)).get('sslmode','require')}
with tempfile.TemporaryFile() as errors:
    proc=subprocess.Popen(['pg_dump','--format=custom','--no-owner','--no-acl','--schema=public','--schema=auth'],env=env,stdout=subprocess.PIPE,stderr=errors)
    manifest['database']=save(proc.stdout,'database.dump')
    if proc.wait():raise RuntimeError('Database export failed. Backup incomplete; inspect operator logs privately.')
for storage_bucket in ['originals','stems','temporary','charts','exports']:
    for name in entries(storage_bucket):
        path=urllib.parse.quote(storage_bucket+'/'+name,safe='/')
        with requests.get(base+'/storage/v1/object/'+path,headers=headers,stream=True,timeout=300) as r:
            r.raise_for_status();r.raw.decode_content=True
            meta=save(r.raw,'objects/'+storage_bucket+'/'+name);manifest['objects'].append({'bucket':storage_bucket,'objectKey':name,**meta})
s3.put_object(Bucket=bucket,Key=prefix+'manifest.json',Body=json.dumps(manifest).encode(),ContentType='application/json',ServerSideEncryption='AES256')
print(json.dumps({'event':'backup.completed','objects':len(manifest['objects']),'prefix':prefix}))
