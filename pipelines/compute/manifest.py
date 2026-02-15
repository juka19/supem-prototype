"""
Manifest generator: builds the API manifest listing available pairs and metadata.
"""

import os
import yaml


def _load_config():
    config_dir = os.path.join(os.path.dirname(__file__), '..', 'config')
    with open(os.path.join(config_dir, 'countries.yaml')) as f:
        countries = yaml.safe_load(f)['countries']
    with open(os.path.join(config_dir, 'sectors.yaml')) as f:
        sectors = yaml.safe_load(f)['sectors']
    with open(os.path.join(config_dir, 'categories.yaml')) as f:
        categories = yaml.safe_load(f)
    return countries, sectors, categories


def build_manifest(ranked_pairs, focus_year, year_range):
    """
    Build the manifest.json content.

    Parameters
    ----------
    ranked_pairs : list[dict]
        Output from ranking.rank_pairs — each has iso3, isic, totalEmissions, rank.
    focus_year : int
        The year used for split bar and sankey computations.
    year_range : tuple[int, int]
        (min_year, max_year) for the trend chart.

    Returns
    -------
    dict — JSON-serializable manifest.
    """
    countries_map, sectors_map, cat_cfg = _load_config()

    # Build pairs with names
    pairs = []
    for p in ranked_pairs:
        pairs.append({
            'iso3': p['iso3'],
            'isic': p['isic'],
            'countryName': countries_map.get(p['iso3'], p['iso3']),
            'sectorName': sectors_map.get(p['isic'], p['isic']),
            'totalEmissions': p['totalEmissions'],
            'rank': p['rank'],
        })

    # Build full country/sector lists for dropdowns
    # Only include countries and sectors that appear in the computed pairs
    pair_countries = sorted(set(p['iso3'] for p in ranked_pairs))
    pair_sectors = sorted(set(p['isic'] for p in ranked_pairs))

    countries_list = [
        {'iso3': c, 'name': countries_map.get(c, c)}
        for c in pair_countries
    ]
    sectors_list = [
        {'isic': s, 'name': sectors_map.get(s, s)}
        for s in pair_sectors
    ]

    # Categories from config
    categories = [
        {'id': c['id'], 'label': c['label'], 'order': c['order']}
        for c in cat_cfg['scopes']
    ]

    return {
        'version': 'v1',
        'focusYear': focus_year,
        'yearRange': list(year_range),
        'pairs': pairs,
        'countries': countries_list,
        'sectors': sectors_list,
        'categories': categories,
    }
