import winreg, boto3, sys

def get_env(name):
    hkey = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Environment')
    return winreg.QueryValueEx(hkey, name)[0]

try:
    s3 = boto3.client('s3', 
      endpoint_url=f'https://{get_env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com',
      aws_access_key_id=get_env('R2_ACCESS_KEY'),
      aws_secret_access_key=get_env('R2_SECRET_KEY'),
      region_name='auto'
    )
    res = s3.list_objects_v2(Bucket='hermetic-labs-triage')
    objects = res.get('Contents', [])
    if not objects: 
        print('Bucket is empty.')
    for obj in sorted(objects, key=lambda x: x['Size'], reverse=True):
      print(f"{obj['Key']}: {obj['Size']/(1024*1024):.2f} MB - {obj['LastModified']}")
except Exception as e:
    print(e)
