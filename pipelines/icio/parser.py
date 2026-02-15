"""
ICIO Parser: reads OECD ICIO CSV files into numpy arrays.

CSV structure (e.g., 2019_SML.csv):
  - Column 1 (V1): row labels ({ISO3}_{ISIC} for industries, TLS/VA/OUT for summary rows)
  - Columns 2-3466: Z block (intermediate flows, 3465 = 77 countries x 45 sectors)
  - Columns 3467-3928: Y block (final demand, 462 = 77 countries x 6 categories)
  - Column 3929: OUT (total output)
  - Last 3 data rows: TLS, VA, OUT
"""

import os
import numpy as np
import pandas as pd

# Number of country-sector pairs in the ICIO (77 countries x 45 sectors)
N_INDUSTRIES = 3465
# Number of final demand columns (77 countries x 6 FD categories)
N_FD_COLS = 462
# Summary rows at the bottom of the CSV
SUMMARY_ROWS = ['TLS', 'VA', 'OUT']


def _parse_label(label):
    """Split 'DEU_C29' into ('DEU', 'C29'). All ICIO country codes are 3 letters."""
    return label[:3], label[4:]


def parse_icio(csv_path, cache_dir=None):
    """
    Parse an ICIO CSV file into structured numpy arrays.

    Parameters
    ----------
    csv_path : str
        Path to the ICIO CSV file (e.g., data/raw/2016-2020_SML/2019_SML.csv).
    cache_dir : str, optional
        Directory for caching parsed arrays as .npz. If provided and a cache
        exists, loads from cache instead of re-parsing the CSV.

    Returns
    -------
    dict with keys:
        Z : np.ndarray (3465, 3465) — intermediate flows matrix
        Y : np.ndarray (3465, 462) — final demand block
        x : np.ndarray (3465,) — total output vector
        va : np.ndarray (3465,) — value added vector
        tls : np.ndarray (3465,) — taxes less subsidies vector
        labels : list[str] — 3465 country-sector labels (e.g., 'ARG_A01_02')
        fd_labels : list[str] — 462 final demand column labels
        countries : list[str] — ordered unique country codes (77)
        sectors : list[str] — ordered unique sector codes (45)
        index : dict — maps (iso3, isic) -> integer index (0..3464)
    """
    basename = os.path.splitext(os.path.basename(csv_path))[0]

    # Try cache first
    if cache_dir:
        cache_path = os.path.join(cache_dir, f'{basename}.npz')
        labels_path = os.path.join(cache_dir, f'{basename}_labels.npz')
        if os.path.exists(cache_path) and os.path.exists(labels_path):
            return _load_cache(cache_path, labels_path)

    print(f'Parsing ICIO CSV: {csv_path}')

    # Read the full CSV. Use V1 as index column.
    df = pd.read_csv(csv_path, index_col=0, low_memory=False)

    # Separate industry rows from summary rows
    all_row_labels = list(df.index)
    industry_labels = all_row_labels[:N_INDUSTRIES]
    # Verify summary rows
    summary_labels = all_row_labels[N_INDUSTRIES:]
    assert summary_labels == SUMMARY_ROWS, (
        f'Expected summary rows {SUMMARY_ROWS}, got {summary_labels}'
    )

    # Column labels
    all_col_labels = list(df.columns)
    z_col_labels = all_col_labels[:N_INDUSTRIES]
    fd_col_labels = all_col_labels[N_INDUSTRIES:N_INDUSTRIES + N_FD_COLS]
    out_col_label = all_col_labels[N_INDUSTRIES + N_FD_COLS]
    assert out_col_label == 'OUT', f'Expected OUT column, got {out_col_label}'

    # Verify industry row and column labels match
    assert industry_labels == z_col_labels, 'Row and column industry labels do not match'

    # Extract matrices
    industry_df = df.iloc[:N_INDUSTRIES]
    Z = industry_df.iloc[:, :N_INDUSTRIES].values.astype(np.float64)
    Y = industry_df.iloc[:, N_INDUSTRIES:N_INDUSTRIES + N_FD_COLS].values.astype(np.float64)

    # Summary vectors (only Z block columns, not FD or OUT)
    tls = df.loc['TLS'].iloc[:N_INDUSTRIES].values.astype(np.float64)
    va = df.loc['VA'].iloc[:N_INDUSTRIES].values.astype(np.float64)
    x = df.loc['OUT'].iloc[:N_INDUSTRIES].values.astype(np.float64)

    # Build metadata
    labels = industry_labels
    countries = []
    sectors = []
    seen_countries = set()
    seen_sectors = set()
    index = {}

    for i, lbl in enumerate(labels):
        iso3, isic = _parse_label(lbl)
        if iso3 not in seen_countries:
            countries.append(iso3)
            seen_countries.add(iso3)
        if isic not in seen_sectors:
            sectors.append(isic)
            seen_sectors.add(isic)
        index[(iso3, isic)] = i

    result = {
        'Z': Z,
        'Y': Y,
        'x': x,
        'va': va,
        'tls': tls,
        'labels': labels,
        'fd_labels': fd_col_labels,
        'countries': countries,
        'sectors': sectors,
        'index': index,
    }

    # Save cache
    if cache_dir:
        os.makedirs(cache_dir, exist_ok=True)
        _save_cache(result, cache_path, labels_path)
        print(f'Cached parsed data to {cache_dir}/')

    return result


def _save_cache(result, cache_path, labels_path):
    """Save parsed ICIO data to .npz files for fast reload."""
    np.savez_compressed(
        cache_path,
        Z=result['Z'],
        Y=result['Y'],
        x=result['x'],
        va=result['va'],
        tls=result['tls'],
    )
    # Labels must be saved separately (string arrays)
    np.savez_compressed(
        labels_path,
        labels=np.array(result['labels']),
        fd_labels=np.array(result['fd_labels']),
        countries=np.array(result['countries']),
        sectors=np.array(result['sectors']),
    )


def _load_cache(cache_path, labels_path):
    """Load previously cached ICIO data."""
    print(f'Loading cached ICIO data from {cache_path}')
    data = np.load(cache_path)
    meta = np.load(labels_path, allow_pickle=True)

    labels = list(meta['labels'])
    index = {}
    for i, lbl in enumerate(labels):
        iso3, isic = _parse_label(lbl)
        index[(iso3, isic)] = i

    return {
        'Z': data['Z'],
        'Y': data['Y'],
        'x': data['x'],
        'va': data['va'],
        'tls': data['tls'],
        'labels': labels,
        'fd_labels': list(meta['fd_labels']),
        'countries': list(meta['countries']),
        'sectors': list(meta['sectors']),
        'index': index,
    }
