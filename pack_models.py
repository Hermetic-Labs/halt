import os
import glob
import tarfile
import winreg
import boto3
import sys
from boto3.s3.transfer import TransferConfig

def get_env(name):
    hkey = winreg.OpenKey(winreg.HKEY_CURRENT_USER, r'Environment')
    return winreg.QueryValueEx(hkey, name)[0]

s3 = boto3.client('s3', 
    endpoint_url=f'https://{get_env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com',
    aws_access_key_id=get_env('R2_ACCESS_KEY'),
    aws_secret_access_key=get_env('R2_SECRET_KEY'),
    region_name='auto'
)

MODELS_DIR = r"C:\Halt\models"
PACKS = {
    "voice": ["kokoro-v1.0.onnx", "voices-v1.0.bin"],
    "stt": ["faster-whisper-base"],
    "translation": ["nllb-200-distilled-600M-ct2"],
    "ai": [os.path.basename(f) for f in glob.glob(os.path.join(MODELS_DIR, "*.gguf"))]
}

config = TransferConfig(
    multipart_threshold=100 * 1024 * 1024, max_concurrency=4, multipart_chunksize=100 * 1024 * 1024, use_threads=True
)

class ProgressPercentage:
    def __init__(self, filename):
        self._filename = filename
        self._size = float(os.path.getsize(filename))
        self._seen_so_far = 0
        import threading
        self._lock = threading.Lock()

    def __call__(self, bytes_amount):
        with self._lock:
            self._seen_so_far += bytes_amount
            percentage = (self._seen_so_far / self._size) * 100
            sys.stdout.write(
                f"\r    {percentage:.1f}% ({self._seen_so_far / (1024**2):.1f} MB / {self._size / (1024**2):.1f} MB)"
            )
            sys.stdout.flush()

bucket = 'hermetic-labs-triage'

for pack_id, files in PACKS.items():
    tar_path = os.path.join(MODELS_DIR, f"{pack_id}.tar.gz")
    print(f"\n[1/2] Packing {pack_id}.tar.gz...")
    
    with tarfile.open(tar_path, "w:gz") as tar:
        for f in files:
            full_path = os.path.join(MODELS_DIR, f)
            if os.path.exists(full_path):
                print(f"  Adding {f} ...")
                tar.add(full_path, arcname=f)
            else:
                print(f"  WARNING: {f} not found!")

    size_mb = os.path.getsize(tar_path) / (1024*1024)
    print(f"[2/2] Uploading {pack_id}.tar.gz ({size_mb:.2f} MB) to R2...")
    s3.upload_file(tar_path, bucket, f"{pack_id}.tar.gz", Config=config, Callback=ProgressPercentage(tar_path))
    print("\n  Upload complete!")
    
print("\nAll model packs pushed successfully.")
