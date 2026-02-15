"""
Split slice builder: generates scope-breakdown data for the split bar visualization.
"""

import os
import yaml


def _load_config():
    """Load categories and label configs."""
    config_dir = os.path.join(os.path.dirname(__file__), '..', 'config')
    with open(os.path.join(config_dir, 'categories.yaml')) as f:
        cat_cfg = yaml.safe_load(f)
    with open(os.path.join(config_dir, 'countries.yaml')) as f:
        countries = yaml.safe_load(f)['countries']
    with open(os.path.join(config_dir, 'sectors.yaml')) as f:
        sectors = yaml.safe_load(f)['sectors']
    return cat_cfg, countries, sectors


def build_split_slice(emissions_lookup, iso3, isic, year):
    """
    Build a split bar (scope breakdown) JSON slice.

    Parameters
    ----------
    emissions_lookup : EmissionsLookup
        Parsed emissions data.
    iso3 : str
        Country code.
    isic : str
        Sector code.
    year : int
        Focus year.

    Returns
    -------
    dict — JSON-serializable split slice.
    """
    cat_cfg, countries, sectors = _load_config()
    scopes = emissions_lookup.get_scopes(year, iso3, isic)
    total = sum(scopes.values())

    categories = []
    components = []
    for cat in cat_cfg['scopes']:
        cat_id = cat['id']
        val = scopes.get(cat_id, 0.0)
        share = val / total if total > 0 else 0.0

        categories.append({
            'id': cat_id,
            'label': cat['label'],
            'order': cat['order'],
        })
        components.append({
            'key': cat_id,
            'label': cat['label'],
            'value': round(val, 3),
            'share': round(share, 4),
        })

    return {
        'year': int(year),
        'country': iso3,
        'countryName': countries.get(iso3, iso3),
        'sector': isic,
        'sectorName': sectors.get(isic, isic),
        'unit': 'MtCO2e',
        'total': round(total, 3),
        'categories': categories,
        'components': components,
    }
