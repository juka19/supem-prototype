"""
CLI entrypoint for the data pipeline.

Usage:
    python -m pipelines.main parse-icio --year 2019
    python -m pipelines.main compute --top-n 50
    python -m pipelines.main compute --pair DEU C29
    python -m pipelines.main upload
    python -m pipelines.main run --top-n 50
"""

import os
import sys
import time

import click
import numpy as np

# Add project root to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from pipelines.icio.parser import parse_icio
from pipelines.emissions.parser import parse_emissions, EmissionsLookup
from pipelines.compute.trend import build_trend_slice
from pipelines.compute.split import build_split_slice
from pipelines.compute.sankey import compute_upstream_tiers, compute_downstream_tiers
from pipelines.compute.ranking import rank_pairs
from pipelines.compute.manifest import build_manifest
from pipelines.layout.sankey_layout import layout_sankey
from pipelines.storage.local import write_pair_slices, write_manifest


# Default paths
DATA_DIR = os.environ.get('ICIO_DATA_DIR', './data')
RAW_DIR = os.path.join(DATA_DIR, 'raw')
CACHE_DIR = os.path.join(DATA_DIR, 'intermediate')
OUT_DIR = os.path.join(DATA_DIR, 'out')
ICIO_DIR = os.path.join(RAW_DIR, '2016-2020_SML')
EMISSIONS_PATH = os.path.join(RAW_DIR, 'DF_SCOPE_csv', 'DF_SCOPE.csv')

ICIO_YEARS = range(2016, 2021)
FOCUS_YEAR = 2020  # Latest ICIO year


@click.group()
def cli():
    """ICIO data pipeline for the SUPEM prototype."""
    pass


@cli.command()
@click.option('--year', type=int, default=None, help='Parse a specific year (default: all)')
def parse_icio_cmd(year):
    """Parse ICIO CSV files into cached .npz format."""
    years = [year] if year else ICIO_YEARS
    for y in years:
        csv_path = os.path.join(ICIO_DIR, f'{y}_SML.csv')
        if not os.path.exists(csv_path):
            click.echo(f'Skipping {y}: {csv_path} not found')
            continue
        t0 = time.time()
        parse_icio(csv_path, cache_dir=CACHE_DIR)
        click.echo(f'  Parsed {y} in {time.time()-t0:.1f}s')


@cli.command()
@click.option('--top-n', type=int, default=50, help='Compute top N pairs')
@click.option('--pair', nargs=2, type=str, default=None, help='Compute a specific pair (ISO3 ISIC)')
@click.option('--top-k', type=int, default=10, help='Top K nodes per sankey tier')
@click.option('--min-share', type=float, default=0.005, help='Min share threshold for sankey')
def compute(top_n, pair, top_k, min_share):
    """Compute JSON slices for visualization."""
    click.echo('Loading emissions data...')
    df = parse_emissions(EMISSIONS_PATH)
    em = EmissionsLookup(df)

    click.echo(f'Loading ICIO for {FOCUS_YEAR}...')
    icio = parse_icio(
        os.path.join(ICIO_DIR, f'{FOCUS_YEAR}_SML.csv'),
        cache_dir=CACHE_DIR,
    )

    # Build S1 emissions vector for ICIO alignment
    N = len(icio['labels'])
    e_s1 = np.zeros(N)
    for i, lbl in enumerate(icio['labels']):
        iso3, isic = lbl[:3], lbl[4:]
        e_s1[i] = em.get(FOCUS_YEAR, iso3, isic, 'S1')

    # Determine which pairs to compute
    if pair:
        pairs_to_compute = [{'iso3': pair[0], 'isic': pair[1]}]
    else:
        click.echo(f'Ranking pairs by total emissions ({FOCUS_YEAR})...')
        ranked = rank_pairs(em, FOCUS_YEAR, top_n=top_n)
        pairs_to_compute = ranked
        click.echo(f'  Top {len(ranked)} pairs selected')

    # Compute slices for each pair
    trend_years = list(ICIO_YEARS)
    total = len(pairs_to_compute)

    for i, p in enumerate(pairs_to_compute):
        iso3, isic = p['iso3'], p['isic']
        idx = icio['index'].get((iso3, isic))
        if idx is None:
            click.echo(f'  [{i+1}/{total}] {iso3}:{isic} — not found in ICIO, skipping')
            continue

        click.echo(f'  [{i+1}/{total}] {iso3}:{isic}...')
        t0 = time.time()

        # Trend
        trend = build_trend_slice(em, iso3, isic, years=trend_years)

        # Split
        split = build_split_slice(em, iso3, isic, FOCUS_YEAR)

        # Get scope totals from DF_SCOPE for sankey calibration
        s3u_total = em.get(FOCUS_YEAR, iso3, isic, 'S3U')
        s3d_total = em.get(FOCUS_YEAR, iso3, isic, 'S3D')

        # Upstream sankey (scaled to S3U)
        up_raw = compute_upstream_tiers(icio, e_s1, idx,
                                        n_tiers=3, top_k=top_k, min_share=min_share,
                                        scope_total=s3u_total)
        sankey_up = layout_sankey(up_raw, 'upstream', max_tier=3)

        # Downstream sankey (scaled to S3D)
        dn_raw = compute_downstream_tiers(icio, e_s1, idx,
                                           n_tiers=3, top_k=top_k, min_share=min_share,
                                           scope_total=s3d_total)
        sankey_dn = layout_sankey(dn_raw, 'downstream', max_tier=3)

        # Write
        write_pair_slices(OUT_DIR, iso3, isic, trend, split, sankey_up, sankey_dn)
        click.echo(f'    done ({time.time()-t0:.1f}s)')

    # Build and write manifest
    if not pair:
        click.echo('Building manifest...')
        ranked_for_manifest = rank_pairs(em, FOCUS_YEAR, top_n=top_n)
        manifest = build_manifest(
            ranked_for_manifest,
            focus_year=FOCUS_YEAR,
            year_range=(min(trend_years), max(trend_years)),
        )
        write_manifest(OUT_DIR, manifest)
        click.echo(f'Manifest written with {len(ranked_for_manifest)} pairs')

    click.echo('Done!')


@cli.command()
@click.option('--bucket', type=str, default=None, help='R2 bucket name (default: R2_BUCKET_NAME env)')
def upload(bucket):
    """Upload generated slices from data/out/ to Cloudflare R2."""
    from pipelines.storage.r2 import upload_directory
    click.echo(f'Uploading {OUT_DIR} to R2...')
    upload_directory(OUT_DIR, bucket_name=bucket)


@cli.command()
@click.option('--top-n', type=int, default=50, help='Compute top N pairs')
@click.pass_context
def run(ctx, top_n):
    """Full pipeline: parse → compute → upload."""
    ctx.invoke(parse_icio_cmd)
    ctx.invoke(compute, top_n=top_n)
    click.echo('\nTo upload, run: python -m pipelines.main upload')


if __name__ == '__main__':
    cli()
