import winreg, boto3

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
    bucket = 'hermetic-labs-triage'
    
    # We want to KEEP 'HALT-latest-Windows.zip' and the macOS builds.
    # We want to DELETE all the specific v1.0.X zipped builds.
    res = s3.list_objects_v2(Bucket=bucket)
    objects = res.get('Contents', [])
    
    deleted_bytes = 0
    to_delete = []
    
    for obj in objects:
        key = obj['Key']
        if key.startswith('HALT-v1.0') and key.endswith('Windows.zip'):
            to_delete.append(key)
            deleted_bytes += obj['Size']
            
    if to_delete:
        print(f"Deleting {len(to_delete)} old Windows builds...")
        for key in to_delete:
            s3.delete_object(Bucket=bucket, Key=key)
            print(f"Deleted: {key}")
            
        print(f"\nSuccessfully purged {deleted_bytes / (1024*1024*1024):.2f} GB from R2.")
    else:
        print("No old builds to delete.")

except Exception as e:
    print(f"Error: {e}")
