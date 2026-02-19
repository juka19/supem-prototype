"""
Scatter slice builder: aggregates country-level emissions for the cover scatter plot.

Output: one JSON file with all countries, each having:
  x = total S1 (production-based emissions)
  y = net embodied emission imports (S3U - S3D)
  size = total footprint (_T)
  colorValue = y (for diverging color scale)
"""

import os
import yaml


def _load_countries():
    config_dir = os.path.join(os.path.dirname(__file__), '..', 'config')
    with open(os.path.join(config_dir, 'countries.yaml')) as f:
        return yaml.safe_load(f)['countries']


def build_scatter_slice(emissions_lookup, year):
    """
    Build the scatter plot dataset for the cover view.

    Aggregates DF_SCOPE data by country for the given year.

    Parameters
    ----------
    emissions_lookup : EmissionsLookup
    year : int

    Returns
    -------
    dict — JSON-serializable scatter slice.
    """
    countries_map = _load_countries()
    agg = emissions_lookup.get_country_aggregates(year)

    points = []
    for _, row in agg.iterrows():
        iso3 = row['iso3']
        if iso3 == 'ROW':
            continue  # Skip "Rest of World" aggregate — not a real country

        s1 = row.get('S1', 0.0)
        s3u = row.get('S3U', 0.0)
        s3d = row.get('S3D', 0.0)
        total = row.get('_T', 0.0)

        if total <= 0:
            continue

        net_imports = s3u - s3d

        points.append({
            'iso3': iso3,
            'name': countries_map.get(iso3, iso3),
            'x': round(s1, 3),
            'y': round(net_imports, 3),
            'size': round(total, 3),
            'colorValue': round(net_imports, 3),
        })

    # Sort by total descending for consistent ordering
    points.sort(key=lambda p: p['size'], reverse=True)

    return {
        'year': int(year),
        'unit': 'MtCO2e',
        'axes': {
            'x': 'Production emissions (S1)',
            'y': 'Net embodied emission imports (S3U − S3D)',
        },
        'points': points,
    }
