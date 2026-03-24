# Cloudflare Deployment & Architecture Guide

This document covers the end-to-end setup for the HALT Medical Triage platform on Cloudflare Pages (Frontend) and Cloudflare R2 (Release Hosting), capturing the exact solutions for the large-file limitations of standard CLI tools.

## 1. Domain Configuration (GoDaddy / GitHub Pages)
If routing the domain via GitHub Pages / Cloudflare, ensure your GoDaddy DNS is clean. **First: Delete everything.** Only keep the `NS` and `SOA` records (if deleting them isn't possible). Any records without a type set or with empty/garbage values must be trashed. 

Then, add these exactly (5 total):
- **A** `@` `185.199.108.153` (TTL: 1/2 Hour)
- **A** `@` `185.199.109.153` (TTL: 1/2 Hour)
- **A** `@` `185.199.110.153` (TTL: 1/2 Hour)
- **A** `@` `185.199.111.153` (TTL: 1/2 Hour)
- **CNAME** `www` `hermetic-labs.github.io` (TTL: 1/2 Hour)

When done, hit Save at the bottom, flip to the GitHub Pages tab, and click "Check again".

---

## 2. Deploying the PWA (Frontend) to Cloudflare Pages
The frontend viewer is a Progressive Web App (PWA) built with Vite and React. The entire application payload needs to be built and deployed using Wrangler.

```bash
# 1. Compile the typescript and build the Vite project using npm
cd "HALT-v1.0.01\resources\app\viewer"
npm run build

# 2. Deploy the generated dist/ folder to Cloudflare Pages
npx wrangler pages deploy dist --project-name hermetic-labs-triage --commit-dirty=true
```
*Note: Ensure the Service Worker registration code in `viewer/index.html` is perfectly intact so that offline PWA caching works once users install the app.*

---

## 3. The 300MB Wrangler Limit & R2 Multipart Uploads
When uploading massive release binaries (e.g. the 4.5GB `HALT-v1.0.zip` exported by Electron Builder, packed with its offline AI models), **you cannot use Wrangler.** The `wrangler r2 object put` command has a hard-coded **300 MB size limit** for local files. 

### Step 3a: Fast-Zipping the Electron Build (Bypassing PowerShell Limits)
Standard PowerShell `Compress-Archive` explicitly fails on payload streams >2GB. Instead, we use Python's built-in `zipfile` module with `allowZip64=True` to smoothly bundle the `win-unpacked` application.

```python
# Create HALT-v1.0.zip securely and quickly (Zero compression, ZIP_STORED)
import zipfile, os, sys

src = 'D:/Halt/HALT-v1.0.01'
dst = 'D:/Halt/HALT-v1.0.zip'

print(f"Zipping {src} into {dst}...")
with zipfile.ZipFile(dst, 'w', zipfile.ZIP_STORED, allowZip64=True) as z:
    for r, d, fs in os.walk(src):
        for f in fs:
            z.write(os.path.join(r, f), os.path.relpath(os.path.join(r, f), src))
print("Done zipping!")
```

### Step 3b: S3 Multipart Upload to Cloudflare R2
Because Wrangler outright refuses the 4.5GB archive, we treat Cloudflare R2 exactly like a standard Amazon S3 bucket. We use the versatile `boto3` library to execute a heavy-duty "multipart upload." It chunks the enormous ZIP file into precise 100MB pieces and uploads them completely in parallel using 4 active streams. 

**Requirements:**
- A generated Cloudflare R2 API Token (Account ID, Access Key ID, Secret Access Key)
- `pip install boto3`

Create an `upload_r2.py` script at the project root and execute it:
```python
import os, sys, boto3, threading
from boto3.s3.transfer import TransferConfig

# Replace with active generated credentials
ACCOUNT_ID = "YOUR_CLOUDFLARE_ACCOUNT_ID"       # e.g., ad23f2f0adb042be51b65f0cfc214835
ACCESS_KEY = "YOUR_R2_ACCESS_KEY_ID"
SECRET_KEY = "YOUR_R2_SECRET_ACCESS_KEY"

BUCKET_NAME = "hermetic-labs-triage"
OBJECT_NAME = "HALT-v1.0.zip"
FILE_PATH = r"D:\Halt\HALT-v1.0.zip"

endpoint_url = f"https://{ACCOUNT_ID}.r2.cloudflarestorage.com"
s3 = boto3.client("s3", endpoint_url=endpoint_url, aws_access_key_id=ACCESS_KEY, aws_secret_access_key=SECRET_KEY, region_name="auto")

# Divide into 100 MB chunks deployed over 4 parallel threads
config = TransferConfig(multipart_threshold=100*1024*1024, max_concurrency=4, multipart_chunksize=100*1024*1024, use_threads=True)

class ProgressPercentage(object):
    def __init__(self, filename):
        self._size = float(os.path.getsize(filename))
        self._seen_so_far = 0
        self._lock = threading.Lock()

    def __call__(self, bytes_amount):
        with self._lock:
            self._seen_so_far += bytes_amount
            percentage = (self._seen_so_far / self._size) * 100
            sys.stdout.write(f"\r  {percentage:.1f}% ({self._seen_so_far / (1024**2):.1f} MB / {self._size / (1024**2):.1f} MB)")
            sys.stdout.flush()

print(f"Uploading {FILE_PATH} ({os.path.getsize(FILE_PATH) / (1024**3):.2f} GB)")
try:
    s3.upload_file(FILE_PATH, BUCKET_NAME, OBJECT_NAME, Config=config, Callback=ProgressPercentage(FILE_PATH))
    print("\nUpload complete via S3 multipart!")
except Exception as e:
    print(f"\nUpload failed: {e}")
```

---

## 4. Enabling Public Access
Once the python upload finishes (typically ~2 minutes for 4.5GB running 4 parallel streams):
1. In the **Cloudflare dashboard**, navigate to **R2** → click on the `hermetic-labs-triage` bucket.
2. Formally click on the **Settings** tab.
3. Under the *Public Access* section, click **Allow Access** and enable the `R2.dev` subdomain.
4. Confirm the prompt.

**That's it.** It will supply you with a one-click universal download URL. Free. Forever. No bandwidth ingress/egress charges:
`https://pub-<YOUR_HASH>.r2.dev/HALT-v1.0.zip`

> **⚠️ Quick Security Note:** You should rotate API credentials thoroughly after a major release. Go to Cloudflare Dashboard → R2 → Manage R2 API Tokens, decisively delete the "HALT Upload" token used in your script, and generate a new one the next time you push a build.
