"""
Local file writer: writes JSON slices to data/out/ for local testing and R2 upload.
"""

import json
import os


def write_json(data, path):
    """Write a dict as JSON to the given path, creating directories as needed."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))


def write_pair_slices(out_dir, iso3, isic, trend, split, sankey_up, sankey_dn):
    """
    Write all slice files for a single country-sector pair.

    Parameters
    ----------
    out_dir : str
        Base output directory (e.g., 'data/out').
    iso3, isic : str
        Country and sector codes.
    trend : dict
        Trend slice data.
    split : dict
        Split slice data.
    sankey_up : dict
        Upstream sankey tier outputs keyed by tier (1, 2, 3).
    sankey_dn : dict
        Downstream sankey tier outputs keyed by tier.
    """
    pair_dir = os.path.join(out_dir, 'v1', iso3, isic)

    write_json(trend, os.path.join(pair_dir, 'trend.json'))
    write_json(split, os.path.join(pair_dir, 'split.json'))

    for t in sorted(sankey_up.keys()):
        write_json(sankey_up[t], os.path.join(pair_dir, f'sankey_upstream_t{t}.json'))

    for t in sorted(sankey_dn.keys()):
        write_json(sankey_dn[t], os.path.join(pair_dir, f'sankey_downstream_t{t}.json'))


def write_manifest(out_dir, manifest):
    """Write the manifest.json to the output directory."""
    write_json(manifest, os.path.join(out_dir, 'v1', 'manifest.json'))


def write_cover_slices(out_dir, scatter, sut_slices):
    """
    Write cover gateway JSON files.

    Parameters
    ----------
    out_dir : str
        Base output directory.
    scatter : dict
        Scatter plot data (one file).
    sut_slices : dict
        Mapping of iso3 -> SUT heatmap data.
    """
    cover_dir = os.path.join(out_dir, 'v1', 'cover')

    write_json(scatter, os.path.join(cover_dir, 'scatter.json'))

    for iso3, sut_data in sut_slices.items():
        write_json(sut_data, os.path.join(cover_dir, f'sut_{iso3}.json'))
