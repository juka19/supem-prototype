#!/usr/bin/env python3
"""Extract text from the OECD methodology PDF."""
import sys
try:
    from pdfminer.high_level import extract_text
    text = extract_text('fc426ab9-en.pdf')
    with open('/tmp/pdf_text.txt', 'w') as f:
        f.write(text)
    print(f"OK: Extracted {len(text)} chars, {text.count(chr(10))} lines")
except Exception as e:
    print(f"ERROR: {e}", file=sys.stderr)
    sys.exit(1)
