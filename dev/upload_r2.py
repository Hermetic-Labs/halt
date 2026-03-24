import os
import sys

try:
    import boto3
    from boto3.s3.transfer import TransferConfig
except ImportError:
    print("boto3 not found. Please install it with 'pip install boto3'")
    sys.exit(1)

ACCOUNT_ID = os.environ.get("CF_ACCOUNT_ID", "")
ACCESS_KEY = os.environ.get("CF_R2_ACCESS_KEY", "")
SECRET_KEY = os.environ.get("CF_R2_SECRET_KEY", "")
BUCKET_NAME = "hermetic-labs-triage"
OBJECT_NAME = "HALT-v1.0.zip"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(SCRIPT_DIR)
FILE_PATH = os.path.join(REPO_ROOT, "HALT-v1.0.zip")

if not all([ACCOUNT_ID, ACCESS_KEY, SECRET_KEY]):
    print("ERROR: Set CF_ACCOUNT_ID, CF_R2_ACCESS_KEY, and CF_R2_SECRET_KEY environment variables.")
    sys.exit(1)

endpoint_url = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"

print(f"Uploading {FILE_PATH} ({os.path.getsize(FILE_PATH) / (1024**3):.2f} GB)")
print(f"Target: {endpoint_url} -> {BUCKET_NAME}/{OBJECT_NAME}")

s3 = boto3.client(
    "s3",
    endpoint_url=endpoint_url,
    aws_access_key_id=ACCESS_KEY,
    aws_secret_access_key=SECRET_KEY,
    region_name="auto"
)

# 100 MB chunks, 4 parallel threads
config = TransferConfig(
    multipart_threshold=100 * 1024 * 1024,
    max_concurrency=4,
    multipart_chunksize=100 * 1024 * 1024,
    use_threads=True
)

class ProgressPercentage(object):
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
            sys.stdout.write(f"\r  {percentage:.1f}% ({self._seen_so_far / (1024**2):.1f} MB / {self._size / (1024**2):.1f} MB)")
            sys.stdout.flush()

print("Proceeding with multipart upload...")
try:
    s3.upload_file(
        FILE_PATH,
        BUCKET_NAME,
        OBJECT_NAME,
        Config=config,
        Callback=ProgressPercentage(FILE_PATH)
    )
    print("\nUpload complete!")
except Exception as e:
    print(f"\nUpload failed: {e}")
