"""
R2 uploader: uploads generated slices to Cloudflare R2 via boto3.

Requires environment variables:
    R2_ACCOUNT_ID
    R2_ACCESS_KEY_ID
    R2_SECRET_ACCESS_KEY
    R2_BUCKET_NAME
"""

import gzip
import json
import os

import boto3


def create_r2_client():
    """Create a boto3 S3 client configured for Cloudflare R2."""
    account_id = os.environ['R2_ACCOUNT_ID']
    return boto3.client(
        's3',
        endpoint_url=f'https://{account_id}.r2.cloudflarestorage.com',
        aws_access_key_id=os.environ['R2_ACCESS_KEY_ID'],
        aws_secret_access_key=os.environ['R2_SECRET_ACCESS_KEY'],
        region_name='auto',
    )


def upload_directory(out_dir, bucket_name=None, prefix=''):
    """
    Upload all JSON files from out_dir to R2, gzip-compressed.

    Parameters
    ----------
    out_dir : str
        Local directory containing generated slices (e.g., 'data/out').
    bucket_name : str, optional
        R2 bucket name. Defaults to R2_BUCKET_NAME env var.
    prefix : str
        Optional key prefix.
    """
    if bucket_name is None:
        bucket_name = os.environ['R2_BUCKET_NAME']

    client = create_r2_client()
    uploaded = 0

    for root, dirs, files in os.walk(out_dir):
        for fname in files:
            if not fname.endswith('.json'):
                continue

            local_path = os.path.join(root, fname)
            # Compute R2 key from relative path
            rel_path = os.path.relpath(local_path, out_dir)
            key = os.path.join(prefix, rel_path) if prefix else rel_path

            # Read and gzip
            with open(local_path, 'rb') as f:
                raw = f.read()
            compressed = gzip.compress(raw)

            client.put_object(
                Bucket=bucket_name,
                Key=key,
                Body=compressed,
                ContentType='application/json',
                ContentEncoding='gzip',
                CacheControl='public, max-age=86400',
            )
            uploaded += 1
            if uploaded % 50 == 0:
                print(f'  Uploaded {uploaded} files...')

    print(f'Upload complete: {uploaded} files to r2://{bucket_name}/')
