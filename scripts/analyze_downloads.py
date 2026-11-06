#!/usr/bin/env python3
"""Analyze downloaded Garmin files to debug sync issues."""

import os
import struct
from pathlib import Path
from datetime import datetime, timedelta

APP_DATA = Path.home() / "Library/Application Support/go-birdie-desktop/fit-files"

def analyze_file(path: Path) -> dict:
    """Analyze a single file."""
    data = path.read_bytes()
    info = {
        'name': path.name,
        'size': len(data),
        'ext': path.suffix,
        'header': data[:4].hex() if len(data) >= 4 else 'N/A',
    }
    
    # Check if FIT format
    if len(data) >= 12:
        if data[8:12] == b'.FIT':
            info['format'] = 'FIT'
        else:
            info['format'] = 'GPC (not FIT)'
    
    # Try to extract timestamp from filename
    stem = path.stem
    if stem.startswith('20') and len(stem) >= 10:
        try:
            parts = stem.split('-')
            if len(parts) >= 6:
                dt = datetime(int(parts[0]), int(parts[1]), int(parts[2]),
                             int(parts[3]), int(parts[4]), int(parts[5]))
                info['file_timestamp'] = dt.strftime('%Y-%m-%d %H:%M:%S')
        except:
            pass
    
    return info

def main():
    if not APP_DATA.exists():
        print(f"App data directory not found: {APP_DATA}")
        return
    
    files = sorted(APP_DATA.glob('*'), key=lambda p: p.stat().st_mtime, reverse=True)
    
    print(f"=== Downloaded Files ({len(files)} total) ===\n")
    
    # Group by date
    by_date = {}
    for f in files:
        mtime = datetime.fromtimestamp(f.stat().st_mtime)
        date_key = mtime.strftime('%Y-%m-%d')
        if date_key not in by_date:
            by_date[date_key] = []
        by_date[date_key].append(f)
    
    print("=== Recent Downloads (by modification time) ===\n")
    for date_key in sorted(by_date.keys(), reverse=True)[:5]:
        print(f"--- {date_key} ---")
        for f in by_date[date_key][:10]:
            info = analyze_file(f)
            ts = info.get('file_timestamp', '')
            fmt = info.get('format', '?')
            print(f"  {info['name']:40} {info['size']:>8} bytes  {fmt:10} {ts}")
        print()
    
    # Find .gpc files
    gpc_files = list(APP_DATA.glob('*.gpc'))
    print(f"=== GPC Files ({len(gpc_files)}) ===\n")
    for f in sorted(gpc_files, key=lambda p: p.name, reverse=True)[:10]:
        info = analyze_file(f)
        ts = info.get('file_timestamp', '')
        print(f"  {info['name']:40} {info['size']:>8} bytes  {ts}")
    
    print(f"\n=== Timestamp-named Activity Files ===\n")
    for f in sorted(APP_DATA.glob('20*.fit'), key=lambda p: p.name, reverse=True)[:10]:
        info = analyze_file(f)
        ts = info.get('file_timestamp', '')
        fmt = info.get('format', '?')
        print(f"  {info['name']:40} {info['size']:>8} bytes  {fmt:10} {ts}")

if __name__ == '__main__':
    main()
